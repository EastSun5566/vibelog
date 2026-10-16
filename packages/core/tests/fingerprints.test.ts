import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { dependencyFingerprint, fingerprintFiles } from '../src/core/fingerprint-inputs.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibelog-fingerprint-'));
  roots.push(root);
  return root;
}
async function file(root: string, name: string, content: string): Promise<void> {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe('fingerprint inputs', () => {
  it('uses sorted relative paths and bytes, independent of checkout location and mtimes', async () => {
    const first = await temporaryRoot();
    const second = await temporaryRoot();
    for (const root of [first, second]) {
      await file(root, 'nested/a.js', 'export const a = 1;');
      await file(root, 'b.css', 'body { color: blue; }');
    }
    const key = fingerprintFiles(first, [join(first, 'b.css'), join(first, 'nested/a.js')]);
    expect(fingerprintFiles(second, [join(second, 'nested/a.js'), join(second, 'b.css')])).toBe(
      key,
    );
    await file(second, 'nested/a.js', 'export const a = 2;');
    expect(fingerprintFiles(second, [join(second, 'nested/a.js'), join(second, 'b.css')])).not.toBe(
      key,
    );
    expect(() => fingerprintFiles(first, [join(first, 'missing')])).toThrow();
  });

  it('tracks resolved transitive versions, optional presence and cycles without exports or path dependence', async () => {
    const first = await temporaryRoot();
    const second = await temporaryRoot();
    const seed = async (root: string, version: string): Promise<void> => {
      await file(root, 'package.json', '{}');
      await file(
        root,
        'node_modules/render/package.json',
        JSON.stringify({
          name: 'render',
          version: '1.0.0',
          exports: { './only': './only.js' },
          dependencies: { nested: 'latest' },
          optionalDependencies: { optional: '*' },
        }),
      );
      await file(
        root,
        'node_modules/nested/package.json',
        JSON.stringify({
          name: 'nested',
          version,
          dependencies: { render: '*' },
        }),
      );
    };
    await seed(first, '1.0.0');
    await seed(second, '1.0.0');
    const key = dependencyFingerprint(first, ['render']);
    expect(dependencyFingerprint(second, ['render', 'render'])).toBe(key);
    const packageRoot = fileURLToPath(new URL('../', import.meta.url));
    for (const path of ['core/build-fingerprints.js', 'core/fingerprint-inputs.js']) {
      await file(second, `dist/${path}`, await readFile(join(packageRoot, 'dist', path), 'utf8'));
    }
    await file(
      second,
      'dist/core/build-fingerprints.json',
      JSON.stringify({
        version: 1,
        template: 'a'.repeat(64),
        source: 'b'.repeat(64),
        renderer: 'c'.repeat(64),
        dependencies: ['render'],
      }),
    );
    const runtimeKey = (): string =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `const { rendererFingerprint } = await import(${JSON.stringify(pathToFileURL(join(second, 'dist/core/build-fingerprints.js')).href)}); console.log(rendererFingerprint);`,
        ],
        { encoding: 'utf8' },
      ).trim();
    const installedKey = runtimeKey();
    await seed(second, '1.0.1');
    expect(dependencyFingerprint(second, ['render'])).not.toBe(key);
    expect(runtimeKey()).not.toBe(installedKey);
    await seed(second, '1.0.0');
    await file(
      second,
      'node_modules/optional/package.json',
      '{"name":"optional","version":"1.0.0"}',
    );
    expect(dependencyFingerprint(second, ['render'])).not.toBe(key);
    await rm(join(second, 'node_modules/nested'), { recursive: true });
    expect(() => dependencyFingerprint(second, ['render'])).toThrow('Missing rendering dependency');
  });

  it('generates stable distributable metadata and invalidates only rendering inputs', async () => {
    const packageRoot = fileURLToPath(new URL('../', import.meta.url));
    const generator = new URL('../scripts/build-fingerprints.mjs', import.meta.url).href;
    const first = await temporaryRoot();
    const second = await temporaryRoot();
    for (const root of [first, second]) {
      await cp(join(packageRoot, 'dist'), join(root, 'dist'), { recursive: true });
      await cp(join(packageRoot, 'template'), join(root, 'template'), { recursive: true });
      await symlink(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    }
    interface Result {
      template: string;
      renderer: string;
      source: string;
      dependencies: string[];
      keys: { build: string; search: string };
    }
    const generate = async (root: string): Promise<Result> => {
      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
        const { generateBuildFingerprints } = await import(${JSON.stringify(generator)});
        await generateBuildFingerprints(process.argv[1]);
        const { structuralBuildIdentity, searchIndexIdentity } = await import(${JSON.stringify(pathToFileURL(join(root, 'dist/core/builder.js')).href)});
        const { DEFAULT_DESIGN_V2 } = await import(${JSON.stringify(pathToFileURL(join(root, 'dist/design/defaults-v2.js')).href)});
        console.log(JSON.stringify({ build: structuralBuildIdentity('source', DEFAULT_DESIGN_V2, 'https://writer.example.com'), search: searchIndexIdentity('source', 'https://writer.example.com') }));
      `,
          root,
        ],
        { encoding: 'utf8' },
      );
      const text = await readFile(join(root, 'dist/core/build-fingerprints.json'), 'utf8');
      expect(text).not.toContain(root);
      expect(text).not.toContain(packageRoot);
      return {
        ...(JSON.parse(text) as Omit<Result, 'keys'>),
        keys: JSON.parse(output) as Result['keys'],
      };
    };
    const baseline = await generate(first);
    expect(await generate(second)).toEqual(baseline);
    expect(baseline.dependencies).toContain('pagefind');
    expect(baseline.dependencies).toContain('@astrojs/rss');
    expect(baseline.dependencies).not.toContain('@earendil-works/pi-ai');
    for (const path of [
      'README.md',
      '.github/workflows/ci.yml',
      'dist/adapters/ai/pi-ai.js',
      'cli/main.js',
    ]) {
      await file(second, path, 'unrelated change');
    }
    expect(await generate(second)).toEqual(baseline);
    const footerPath = 'template/src/components/Footer.astro';
    const footer = await readFile(join(second, footerPath), 'utf8');
    await file(second, footerPath, `${footer}\n<!-- new template -->\n`);
    const templateEdit = await generate(second);
    expect(templateEdit.template).not.toBe(baseline.template);
    expect(templateEdit.renderer).not.toBe(baseline.renderer);
    expect(templateEdit.keys.build).not.toBe(baseline.keys.build);
    expect(templateEdit.keys.search).not.toBe(baseline.keys.search);
    await file(second, footerPath, footer);
    for (const path of ['dist/core/render-worker.js', 'dist/core/math-plugins.js']) {
      const original = await readFile(join(second, path), 'utf8');
      await file(second, path, `${original}\n// renderer change\n`);
      const edited = await generate(second);
      expect(edited.renderer).not.toBe(baseline.renderer);
      expect(edited.keys.build).not.toBe(baseline.keys.build);
      expect(edited.keys.search).not.toBe(baseline.keys.search);
      await file(second, path, original);
    }
    expect(await generate(second)).toEqual(baseline);
    await rm(join(second, 'dist/core/math-plugins.js'));
    await expect(generate(second)).rejects.toThrow();
  }, 30_000);
});
