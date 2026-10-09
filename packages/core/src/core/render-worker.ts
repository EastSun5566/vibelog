import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { build as astroBuild } from 'astro';
import mdx from '@astrojs/mdx';
import * as pagefind from 'pagefind';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import { defListHastHandlers, remarkDefinitionList } from 'remark-definition-list';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkGemoji from 'remark-gemoji';
import { remarkHackmdCompatibility } from '../markdown/hackmd.js';
import fs from 'fs-extra';
import { logger } from './logger.js';
import { rehypeKatex, remarkMath } from './math-plugins.js';
import type { BuildStage, BuildOptions } from './builder.js';

export interface RenderOptions {
  vibelogDir: string;
  outDir: string;
  site: string;
  searchCache?: BuildOptions['searchCache'];
}
export type RenderMessage =
  | { type: 'timing'; stage: BuildStage; durationMs: number }
  | { type: 'complete' }
  | { type: 'error'; message: string };

function send(message: RenderMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) { reject(new Error('Blog renderer requires an IPC channel')); return; }
    process.send(message, (error) => { if (error) reject(error); else resolve(); });
  });
}
async function timed(stage: BuildStage, report: (stage: BuildStage, durationMs: number) => void, work: () => Promise<unknown>): Promise<void> {
  const started = performance.now();
  try { await work(); }
  finally { report(stage, Math.round(performance.now() - started)); }
}

interface ShikiElement {
  properties: Record<string, unknown>;
}

interface ShikiTransformerContext {
  options: { meta?: { __raw?: string } };
  addClassToHast(element: ShikiElement, className: string): ShikiElement;
}

function codeMetadata(raw = ''): { highlights: Set<number>; start: number | undefined; wrap: boolean } {
  const startMatch = /(?:^|\s)line-start=(\d+)(?:\s|$)/u.exec(raw);
  const start = startMatch?.[1] ? Number.parseInt(startMatch[1], 10) : undefined;
  const highlights = new Set<number>();
  const highlightMatch = /\[([\d,\s-]+)\]/u.exec(raw);
  if (highlightMatch?.[1]) {
    for (const range of highlightMatch[1].split(',')) {
      const [firstRaw, lastRaw] = range.trim().split('-');
      const first = Number.parseInt(firstRaw ?? '', 10);
      const last = Number.parseInt(lastRaw ?? firstRaw ?? '', 10);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first > 1_000) continue;
      for (let line = first; line <= last; line += 1) highlights.add(line);
    }
  }
  return {
    highlights,
    start: Number.isSafeInteger(start) && (start ?? 0) > 0 ? start : undefined,
    wrap: /(?:^|\s)wrap-code(?:\s|$)/u.test(raw),
  };
}

const codeMetadataTransformer = {
  name: 'vibelog-code-metadata',
  pre(this: ShikiTransformerContext, element: ShikiElement) {
    const metadata = codeMetadata(this.options.meta?.__raw);
    if (metadata.start !== undefined) {
      this.addClassToHast(element, 'has-line-numbers');
      element.properties.dataLineStart = String(metadata.start);
    }
    if (metadata.wrap) this.addClassToHast(element, 'wrap-code');
  },
  line(this: ShikiTransformerContext, element: ShikiElement, line: number) {
    const metadata = codeMetadata(this.options.meta?.__raw);
    const displayLine = (metadata.start ?? 1) + line - 1;
    if (metadata.start !== undefined) element.properties.dataLineNumber = String(displayLine);
    if (metadata.highlights.has(displayLine)) this.addClassToHast(element, 'highlighted');
  },
};
async function externalizeShikiStyles(outDir: string): Promise<void> {
  const styles = new Map<string, string>();

  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const html = await fs.readFile(path, 'utf8');
        const converted = html.replace(/<pre\b[^>]*\bclass="[^"]*\bastro-code\b[^"]*"[^>]*>[\s\S]*?<\/pre>/g, (block) =>
          block.replace(/<(?:pre|span)\b[^>]*\bstyle="[^"]*"[^>]*>/g, (tag) => {
            const style = /\sstyle="([^"]*)"/.exec(tag)?.[1];
            if (!style) return tag;
            if (!/^[\s;:#A-Za-z0-9-]+$/.test(style)) throw new Error('Unexpected Shiki style');
            const className = `syntax-style-${createHash('sha256').update(style).digest('hex').slice(0, 12)}`;
            styles.set(className, style);
            const withoutStyle = tag.replace(/\sstyle="[^"]*"/, '');
            return /\bclass="[^"]*"/.test(withoutStyle)
              ? withoutStyle.replace(/\bclass="([^"]*)"/, `class="$1 ${className}"`)
              : withoutStyle.replace(/^<(pre|span)\b/, `<$1 class="${className}"`);
          }));
        if (converted !== html) await fs.writeFile(path, converted);
      }
    }
  }

  await visit(outDir);
  const css = [...styles].sort(([left], [right]) => left.localeCompare(right))
    .map(([className, style]) => `.${className}{${style}}`)
    .join('\n');
  await fs.writeFile(join(outDir, 'syntax.css'), css);
}

async function render({ vibelogDir, outDir, site, searchCache }: RenderOptions): Promise<void> {
  const report = (stage: BuildStage, durationMs: number) => { process.send?.({ type: 'timing', stage, durationMs } satisfies RenderMessage); };
  await timed('astro', report, () => astroBuild({
    root: vibelogDir,
    cacheDir: join(vibelogDir, '.astro'),
    outDir,
    site,
    integrations: [mdx(), sitemap({ filter: (page) => new URL(page).pathname !== '/search/' })],
    markdown: {
      shikiConfig: {
        themes: {
          light: 'github-light-high-contrast',
          dark: 'github-dark-high-contrast',
        },
        defaultColor: false,
        transformers: [codeMetadataTransformer],
      },
      processor: unified({
        remarkPlugins: [
          remarkDirective,
          remarkHackmdCompatibility,
          [remarkGfm, { singleTilde: false }],
          remarkMath,
          remarkGemoji,
          remarkDefinitionList,
        ],
        rehypePlugins: [[rehypeKatex, {
          output: 'mathml',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
        }]],
        remarkRehype: { handlers: defListHastHandlers },
      }),
    },
    vite: {
      logLevel: 'warn',
    },
  }));

  await timed('syntax-css', report, () => externalizeShikiStyles(outDir));

  if (searchCache) {
    await timed('pagefind', report, async () => {
      const marker = await fs.readJson(join(searchCache.directory, 'search-index.json')).catch(() => null) as { identity?: string } | null;
      if (marker?.identity !== searchCache.identity || !await fs.exists(join(searchCache.directory, 'pagefind', 'pagefind.js'))) throw new Error('Search cache identity or files are invalid');
      await fs.copy(join(searchCache.directory, 'pagefind'), join(outDir, 'pagefind'), { overwrite: true });
    });
  } else {
    logger.info('Indexing selected articles with Pagefind...');
    await timed('pagefind', report, async () => {
      const created = await pagefind.createIndex({ verbose: false });
      if (!created.index || created.errors.length) {
        await pagefind.close();
        throw new Error(`Pagefind could not start indexing: ${created.errors.join('; ') || 'index unavailable'}`);
      }
      const { index } = created;
      try {
        const added = await index.addDirectory({ path: outDir });
        if (added.errors.length || added.page_count === 0) {
          throw new Error(`Pagefind could not index the site: ${added.errors.join('; ') || 'no pages found'}`);
        }
        const written = await index.writeFiles({ outputPath: join(outDir, 'pagefind') });
        if (written.errors.length) throw new Error(`Pagefind could not write its index: ${written.errors.join('; ')}`);
      } finally {
        try { await index.deleteIndex(); }
        finally { await pagefind.close(); }
      }
    });
  }
}

// Astro's cwd and Pagefind's shared service belong only to this build process.
function stop(): void { void pagefind.close().finally(() => { process.exit(1); }); }
process.once('SIGTERM', stop);
process.once('disconnect', stop);
process.once('message', (options: RenderOptions) => {
  void render(options).then(
    () => send({ type: 'complete' }).then(() => { process.exit(0); }),
    (error: unknown) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }).then(() => { process.exit(1); }),
  ).catch(() => { process.exit(1); });
});
