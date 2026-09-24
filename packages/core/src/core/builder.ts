import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname, basename, isAbsolute, relative, sep, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build as astroBuild } from 'astro';
import mdx from '@astrojs/mdx';
import * as pagefind from 'pagefind';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import fs from 'fs-extra';
import matter from 'gray-matter';
import rehypeKatex from 'rehype-katex';
import { defListHastHandlers, remarkDefinitionList } from 'remark-definition-list';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkGemoji from 'remark-gemoji';
import remarkMath from 'remark-math';
import { z } from 'zod';

import { resolvePostDescription } from '../description.js';
import { ContentSourceName } from '../consts.js';
import { createContentProfile } from '../design/profile.js';
import { compileDesignCss } from '../design/compile-css-v2.js';
import { resolveHomeComposition, type ResolvablePost } from '../design/resolve-v2.js';
import { validateBlogDesignSpecV2, type BlogDesignSpecV2 } from '../design/schema-v2.js';
import type { ContentProfile, SourceSnapshotV1 } from '../design/types.js';
import { validateSourceSnapshot } from '../design/validate.js';
import { remarkHackmdCompatibility } from '../markdown/hackmd.js';
import { generateSlug, slugify } from './utils.js';
import { logger } from './logger.js';
import type { ContentSource, Post } from '../types.js';
import { loadConfig } from './config.js';

export const TEMPLATE_VERSION = 16;
export const SEARCH_SCHEMA_VERSION = 2;
export function searchIndexIdentity(sourceArtifactId: string, site: string): string {
  return createHash('sha256').update(sourceArtifactId).update('\0').update(new URL(site).origin).update('\0').update(String(SEARCH_SCHEMA_VERSION)).digest('hex');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
export function structuralBuildIdentity(sourceArtifactId: string, design: BlogDesignSpecV2, site: string): string {
  return createHash('sha256').update(JSON.stringify(canonical({ sourceArtifactId, design: validateBlogDesignSpecV2(design), site: new URL(site).origin, templateVersion: TEMPLATE_VERSION, searchSchemaVersion: SEARCH_SCHEMA_VERSION }))).digest('hex');
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
const postSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  description: z.string().optional(),
  slug: z.string(),
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid post date'),
  tags: z.array(z.string()).optional().default([]),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid post modified date').optional(),
});

function normalizeTagName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function tagKey(value: string): string {
  return value.toLocaleLowerCase('und');
}

function tagHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizePostTags(posts: z.infer<typeof postSchema>[]): BuildPostTag[][] {
  const displayNames = new Map<string, string>();
  const postKeys: string[][] = [];
  for (const post of posts) {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const rawTag of post.tags) {
      const name = normalizeTagName(rawTag);
      if (!name) continue;
      const key = tagKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (!displayNames.has(key)) displayNames.set(key, name);
    }
    postKeys.push(keys);
  }

  const keysByBaseSlug = new Map<string, string[]>();
  for (const [key, name] of displayNames) {
    const baseSlug = slugify(name);
    const keys = keysByBaseSlug.get(baseSlug) ?? [];
    keys.push(key);
    keysByBaseSlug.set(baseSlug, keys);
  }
  const tagsByKey = new Map<string, BuildPostTag>();
  for (const [key, name] of displayNames) {
    const baseSlug = slugify(name);
    const collides = (keysByBaseSlug.get(baseSlug)?.length ?? 0) > 1;
    const slug = !baseSlug || collides ? `${baseSlug || 'tag'}-${tagHash(key)}` : baseSlug;
    tagsByKey.set(key, { name, slug });
  }

  return postKeys.map((keys) => keys
    .map((key) => tagsByKey.get(key))
    .filter((tag): tag is BuildPostTag => Boolean(tag))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')));
}

function isPathInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== '' && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot);
}

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

async function findTemplateDir() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const templateDir = resolve(
    currentDir,
    basename(currentDir) === 'dist' ? '..' : '../..',
    'template',
  );
  if (!await fs.exists(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  return templateDir;
}

export interface DevBuilderOptions {
  root: string;
  contentSource: ContentSource;
  baseDir?: string;
}
export interface BuildPostSummary {
  title: string;
  slug: string;
  description?: string;
  publishedAt: string;
  included: boolean;
  tags: BuildPostTag[];
  updatedAt?: string;
  contentHash?: string;
}
export interface BuildPostTag { name: string; slug: string }
export interface BuildContentSummary {
  site: { title: string; description: string; language: string };
  author: { name: string; bio: string };
  posts: BuildPostSummary[];
  contentProfile: ContentProfile;
}
export class DevBuilder {
  readonly root: string;
  readonly vibelogDir: string;
  readonly contentSource: ContentSource;

  constructor({ root, contentSource, baseDir = process.cwd() }: DevBuilderOptions) {
    this.root = resolve(baseDir, root);
    this.vibelogDir = resolve(this.root, '.vibelog');
    this.contentSource = contentSource;
  }

  private async ensurePackagedRuntime(directory: string): Promise<void> {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageRoot = basename(currentDir) === 'dist' ? dirname(currentDir) : resolve(currentDir, '../..');
    const directNodeModules = join(packageRoot, 'node_modules');
    const runtimeNodeModules = await fs.exists(join(directNodeModules, '@astrojs', 'rss'))
      ? directNodeModules
      : resolve(packageRoot, '../..');
    for (const requiredPackage of [
      join('astro', 'package.json'),
      join('@astrojs', 'rss', 'package.json'),
    ]) {
      if (!await fs.exists(join(runtimeNodeModules, requiredPackage))) {
        throw new Error(`Packaged template runtime is incomplete: ${requiredPackage}`);
      }
    }
    const runtimeLink = join(directory, 'node_modules');
    if (!await fs.exists(runtimeLink)) {
      await fs.ensureSymlink(runtimeNodeModules, runtimeLink, 'junction');
    }
  }

  private async initVibelogDir({ installDependencies }: { installDependencies: boolean }) {
    const templateDir = await findTemplateDir();
    await fs.ensureDir(this.root);
    const stagingDir = join(this.root, `.vibelog-staging-${randomUUID()}`);
    const backupDir = join(this.root, `.vibelog-backup-${randomUUID()}`);
    await fs.copy(templateDir, stagingDir);

    await fs.writeJson(join(stagingDir, '.vibelog-state.json'), { templateVersion: TEMPLATE_VERSION });

    if (installDependencies) {
      logger.info('Installing template dependencies...');
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: stagingDir,
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      });
      logger.info('Template dependencies installed successfully');
    } else {
      await this.ensurePackagedRuntime(stagingDir);
    }

    const hadExisting = await fs.exists(this.vibelogDir);
    if (hadExisting) await fs.move(this.vibelogDir, backupDir);
    try {
      await fs.move(stagingDir, this.vibelogDir);
      if (hadExisting) await fs.remove(backupDir);
    } catch (error) {
      await fs.remove(stagingDir);
      if (hadExisting && await fs.exists(backupDir)) await fs.move(backupDir, this.vibelogDir);
      throw error;
    }
  }

  async prepare(options: { installDependencies?: boolean } = {}) {
    const installDependencies = options.installDependencies ?? true;
    if (await fs.exists(this.vibelogDir)) {
      const statePath = join(this.vibelogDir, '.vibelog-state.json');
      const state = await fs.readJson(statePath).catch(() => null) as { templateVersion?: number } | null;
      if (state?.templateVersion === TEMPLATE_VERSION) {
        if (!installDependencies) await this.ensurePackagedRuntime(this.vibelogDir);
        logger.info('Using current ".vibelog" directory');
        return;
      }
      logger.info('Upgrading generated VibeLog template...');
    } else {
      logger.info('Initializing ".vibelog"...');
    }

    await this.initVibelogDir({ installDependencies });
  }

  async fetchContent({ excludedSlugs = [] }: { excludedSlugs?: Iterable<string> } = {}): Promise<BuildContentSummary> {
    logger.info(`Fetching ${this.contentSource.name} content...`);

    const [{ posts: rawPosts }, author] = await Promise.all([
      this.contentSource.getPosts(),
      this.contentSource.getAuthor(),
    ]);
    const posts = z.array(postSchema).parse(rawPosts);
    if (!author.name || typeof author.bio !== 'string') {
      throw new Error('Content source returned an invalid author');
    }
    logger.info(`Found ${String(posts.length)} posts by ${author.name}`);

    const config = await loadConfig(this.root);
    const siteTitle = config.site.title ?? basename(this.root);
    const siteDescription = config.site.description ?? author.bio;
    const siteLanguage = config.site.language ?? 'zh-Hant';

    const configContent = `// Auto-generated site configuration
export const SITE_TITLE = ${JSON.stringify(siteTitle)};
export const SITE_DESCRIPTION = ${JSON.stringify(siteDescription)};
export const SITE_LANGUAGE = ${JSON.stringify(siteLanguage)};
`;
    const configPath = join(this.vibelogDir, 'src', 'consts.ts');
    const configStagingPath = `${configPath}.${randomUUID()}.tmp`;
    const configBackupPath = `${configPath}.${randomUUID()}.backup`;
    await fs.writeFile(configStagingPath, configContent);

    const sourceDir = join(this.vibelogDir, 'src');
    const contentDir = join(sourceDir, 'content');
    const stagedContentDir = join(sourceDir, `.content-staging-${randomUUID()}`);
    const backupContentDir = join(sourceDir, `.content-backup-${randomUUID()}`);
    const blogDir = join(stagedContentDir, 'blog');
    await fs.ensureDir(blogDir);

    const excluded = new Set(excludedSlugs);
    const usedSlugs = new Set<string>();
    const tagsByPost = normalizePostTags(posts);
    const normalizedPosts = posts.map((post, index) => {
      const title = post.title || 'Untitled';
      const baseSlug = slugify(post.slug) || slugify(post.title) || slugify(post.id) || generateSlug();
      const slug = baseSlug;
      if (usedSlugs.has(slug)) throw new Error(`Duplicate post slug after normalization: ${slug}`);
      usedSlugs.add(slug);
      const description = resolvePostDescription(post.description, post.content, title);
      const publishedAt = new Date(post.date).toISOString();
      let updatedAt: string | undefined;
      if (post.updatedAt) {
        const modified = new Date(post.updatedAt);
        if (modified.getTime() > new Date(publishedAt).getTime()) updatedAt = modified.toISOString();
      }
      return {
        ...post,
        title,
        slug,
        description,
        publishedAt,
        contentHash: createHash('sha256').update(post.content, 'utf8').digest('hex'),
        tags: tagsByPost[index] ?? [],
        ...(updatedAt ? { updatedAt } : {}),
        included: !excluded.has(slug),
      };
    });
    if (!normalizedPosts.some((post) => post.included)) throw new Error('No articles selected');

    logger.info('Writing selected blog posts...');
    for (const post of normalizedPosts) {
      if (!post.included) continue;
      const fileContent = matter.stringify(post.content, {
        title: post.title,
        description: post.description,
        date: post.publishedAt,
        slug: post.slug,
        ...(post.updatedAt ? { updatedDate: post.updatedAt } : {}),
        tags: post.tags,
      });

      const filePath = join(blogDir, `${post.slug}.md`);
      await fs.writeFile(filePath, fileContent);
    }

    logger.info('Writing author profile...');
    const authorContent = matter.stringify(author.bio, {
      name: author.name,
    });
    const authorPath = join(stagedContentDir, 'author.md');
    await fs.writeFile(authorPath, authorContent);

    const hadContent = await fs.exists(contentDir);
    const hadConfig = await fs.exists(configPath);
    let contentBackedUp = false;
    let configBackedUp = false;
    let newContentInstalled = false;
    let newConfigInstalled = false;
    try {
      if (hadContent) {
        await fs.move(contentDir, backupContentDir);
        contentBackedUp = true;
      }
      if (hadConfig) {
        await fs.move(configPath, configBackupPath);
        configBackedUp = true;
      }
      await fs.move(stagedContentDir, contentDir);
      newContentInstalled = true;
      await fs.move(configStagingPath, configPath);
      newConfigInstalled = true;
    } catch (error) {
      if (newContentInstalled) await fs.remove(contentDir);
      if (newConfigInstalled) await fs.remove(configPath);
      await fs.remove(stagedContentDir);
      await fs.remove(configStagingPath);
      if (contentBackedUp && await fs.exists(backupContentDir)) await fs.move(backupContentDir, contentDir);
      if (configBackedUp && await fs.exists(configBackupPath)) await fs.move(configBackupPath, configPath);
      throw error;
    }
    if (contentBackedUp) await fs.remove(backupContentDir);
    if (configBackedUp) await fs.remove(configBackupPath);

    logger.info('Content updated successfully');
    const includedPosts = normalizedPosts.filter((post) => post.included);
    return {
      site: { title: siteTitle, description: siteDescription, language: siteLanguage },
      author,
      posts: normalizedPosts
        .map(({ title, slug, description, publishedAt, included, tags, updatedAt, contentHash }) => ({
          title,
          slug,
          description,
          publishedAt,
          included,
          tags,
          contentHash,
          ...(updatedAt ? { updatedAt } : {}),
        }))
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.slug.localeCompare(right.slug)),
      contentProfile: createContentProfile(includedPosts.map((post) => ({ ...post, tags: post.tags.map((tag) => tag.name) })) as Post[]),
    };
  }
}
export function createDevBuilder(options: DevBuilderOptions) {
  return new DevBuilder(options);
}

export interface BuildOptions {
  vibelogDir: string;
  outDir: string;
  site: string;
  onStageTiming?: (stage: BuildStage, durationMs: number) => void;
  searchIdentity?: string;
  searchCache?: { directory: string; identity: string };
  buildIdentity?: string;
}
export type BuildStage = 'prepare' | 'source-copy' | 'astro' | 'syntax-css' | 'pagefind' | 'promote';
async function timed<T>(stage: BuildStage, report: BuildOptions['onStageTiming'], work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); }
  finally { report?.(stage, Math.round(performance.now() - started)); }
}
async function prepareDesignAssets(vibelogDir: string): Promise<void> {
  const design = validateBlogDesignSpecV2(await fs.readJson(join(vibelogDir, 'src', 'generated', 'design.json')));
  const blogDirectory = join(vibelogDir, 'src', 'content', 'blog');
  const posts: ResolvablePost[] = [];
  for (const name of await fs.readdir(blogDirectory)) {
    if (!name.endsWith('.md')) continue;
    const sourcePost = matter(await fs.readFile(join(blogDirectory, name), 'utf8'));
    posts.push({
      slug: name.slice(0, -3),
      publishedAt: new Date(String(sourcePost.data.date)).toISOString(),
      ...(sourcePost.data.updatedDate ? { updatedAt: new Date(String(sourcePost.data.updatedDate)).toISOString() } : {}),
    });
  }
  const composition = resolveHomeComposition(design.pages.home, posts);
  await fs.writeJson(join(vibelogDir, 'src', 'generated', 'resolved-home.json'), Object.fromEntries(
    Object.values(composition.regions).flat().filter((section) => section.posts).map((section) => [section.id, section.posts?.map((post) => post.slug) ?? []]),
  ));
  await fs.writeFile(join(vibelogDir, 'public', 'design.css'), compileDesignCss(design));
}
export async function buildFromVibelog({ vibelogDir, outDir, site, onStageTiming, searchIdentity, searchCache, buildIdentity }: BuildOptions) {
  logger.info('Starting production build...');
  if (searchCache && searchIdentity !== searchCache.identity) throw new Error('Search cache identity does not match build identity');

  if (!await fs.exists(vibelogDir)) {
    throw new Error('The generated Astro draft is missing. Sync the HackMD content first.');
  }

  const siteUrl = new URL(site);
  if (!['http:', 'https:'].includes(siteUrl.protocol)) {
    throw new Error('Site URL must use http or https');
  }

  const resolvedVibelogDir = resolve(vibelogDir);
  const projectRoot = dirname(resolvedVibelogDir);
  const finalOutDir = resolve(outDir);
  if (
    finalOutDir === parsePath(finalOutDir).root
    || finalOutDir === projectRoot
    || finalOutDir === resolvedVibelogDir
    || isPathInside(resolvedVibelogDir, finalOutDir)
    || !isPathInside(projectRoot, finalOutDir)
  ) {
    throw new Error('Build output must be a safe directory inside the project root');
  }

  await prepareDesignAssets(resolvedVibelogDir);

  logger.info('Building with Astro...');

  // Keep prerender chunks below the generated runtime so Node can resolve
  // externalized template dependencies through .vibelog/node_modules.
  const tempOutDir = join(resolvedVibelogDir, `.build-staging-${randomUUID()}`);
  const backupOutDir = `${finalOutDir}.vibelog-backup-${randomUUID()}`;
  const previousWorkingDirectory = process.cwd();
  try {
    // Astro writes prerender chunks below process.cwd() when the project lives
    // elsewhere. Keeping cwd inside the generated project also keeps module
    // resolution inside the pinned, offline template runtime.
    process.chdir(resolvedVibelogDir);
    await timed('astro', onStageTiming, () => astroBuild({
      root: resolvedVibelogDir,
      cacheDir: join(resolvedVibelogDir, '.astro'),
      outDir: tempOutDir,
      site: siteUrl.href,
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

    await timed('syntax-css', onStageTiming, () => externalizeShikiStyles(tempOutDir));

    if (searchCache) {
      await timed('pagefind', onStageTiming, async () => {
        const marker = await fs.readJson(join(searchCache.directory, 'search-index.json')).catch(() => null) as { identity?: string } | null;
        if (marker?.identity !== searchCache.identity || !await fs.exists(join(searchCache.directory, 'pagefind', 'pagefind.js'))) throw new Error('Search cache identity or files are invalid');
        await fs.copy(join(searchCache.directory, 'pagefind'), join(tempOutDir, 'pagefind'), { overwrite: true });
      });
    } else {
    logger.info('Indexing selected articles with Pagefind...');
    await timed('pagefind', onStageTiming, async () => {
    const created = await pagefind.createIndex({ verbose: false });
    if (!created.index || created.errors.length) {
      await pagefind.close();
      throw new Error(`Pagefind could not start indexing: ${created.errors.join('; ') || 'index unavailable'}`);
    }
    const { index } = created;
    try {
      const added = await index.addDirectory({ path: tempOutDir });
      if (added.errors.length || added.page_count === 0) {
        throw new Error(`Pagefind could not index the site: ${added.errors.join('; ') || 'no pages found'}`);
      }
      const written = await index.writeFiles({ outputPath: join(tempOutDir, 'pagefind') });
      if (written.errors.length) throw new Error(`Pagefind could not write its index: ${written.errors.join('; ')}`);
    } finally {
      await index.deleteIndex();
      await pagefind.close();
    }
    });
    }
    if (searchIdentity) await fs.writeJson(join(tempOutDir, 'search-index.json'), { identity: searchIdentity });
    if (buildIdentity) await fs.writeJson(join(tempOutDir, 'build-identity.json'), { identity: buildIdentity });
  } catch (error) {
    await fs.remove(tempOutDir);
    throw error;
  } finally {
    process.chdir(previousWorkingDirectory);
  }

  await timed('promote', onStageTiming, async () => {
  const hadOutput = await fs.exists(finalOutDir);
  if (hadOutput) await fs.move(finalOutDir, backupOutDir);
  try {
    await fs.move(tempOutDir, finalOutDir);
    if (hadOutput) await fs.remove(backupOutDir);
  } catch (error) {
    await fs.remove(tempOutDir);
    await fs.remove(finalOutDir);
    if (hadOutput && await fs.exists(backupOutDir)) {
      await fs.move(backupOutDir, finalOutDir);
    }
    throw error;
  }
  });

  logger.info(`Production build completed in ${outDir}`);
}

export async function writeSourceSnapshot(vibelogDir: string, outDir: string, summary: BuildContentSummary): Promise<SourceSnapshotV1> {
  const root = resolve(vibelogDir);
  const destination = resolve(outDir);
  if (destination === parsePath(destination).root || destination === root || isPathInside(root, destination)) throw new Error('Source snapshot output must be outside the generated project');
  const snapshot = validateSourceSnapshot({ version: 1, site: summary.site, author: summary.author, contentProfile: summary.contentProfile });
  await fs.emptyDir(destination);
  await fs.copy(join(root, 'src', 'content'), join(destination, 'content'));
  await fs.writeJson(join(destination, 'source.json'), snapshot, { spaces: 2 });
  return snapshot;
}

export interface CompileBlogOptions {
  sourceDir: string;
  design: BlogDesignSpecV2;
  workDir: string;
  outDir: string;
  site: string;
  onStageTiming?: BuildOptions['onStageTiming'];
  searchIdentity?: string;
  searchCache?: BuildOptions['searchCache'];
  buildIdentity?: string;
}

export async function buildBlog({ sourceDir, design: inputDesign, workDir, outDir, site, onStageTiming, searchIdentity, searchCache, buildIdentity }: CompileBlogOptions): Promise<void> {
  const sourceRoot = resolve(sourceDir);
  const root = resolve(workDir);
  const finalOutDir = resolve(outDir);
  if (!isPathInside(root, finalOutDir)) throw new Error('Compiled output must be inside the build work directory');
  const source = validateSourceSnapshot(await fs.readJson(join(sourceRoot, 'source.json')));
  const design = validateBlogDesignSpecV2(inputDesign);
  const builder = new DevBuilder({ root, contentSource: {
    name: ContentSourceName.HACKMD,
    getPosts: () => Promise.reject(new Error('Frozen source build cannot fetch posts')),
    getAuthor: () => Promise.reject(new Error('Frozen source build cannot fetch author')),
  } });
  await timed('prepare', onStageTiming, () => builder.prepare({ installDependencies: false }));
  await timed('source-copy', onStageTiming, () => fs.copy(join(sourceRoot, 'content'), join(builder.vibelogDir, 'src', 'content'), { overwrite: true }));
  await fs.ensureDir(join(builder.vibelogDir, 'src', 'generated'));
  await fs.writeJson(join(builder.vibelogDir, 'src', 'generated', 'design.json'), design, { spaces: 2 });
  await fs.writeFile(join(builder.vibelogDir, 'src', 'consts.ts'), `// Auto-generated site configuration\nexport const SITE_TITLE = ${JSON.stringify(source.site.title)};\nexport const SITE_DESCRIPTION = ${JSON.stringify(source.site.description)};\nexport const SITE_LANGUAGE = ${JSON.stringify(source.site.language)};\n`);
  await buildFromVibelog({ vibelogDir: builder.vibelogDir, outDir: finalOutDir, site, onStageTiming, searchIdentity, searchCache, buildIdentity });
}
