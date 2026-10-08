import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'vibelog-core-pack-'));
const env = { ...process.env };
delete env.NODE_PATH;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: directory, env, stdio: 'inherit', timeout: 300_000, ...options });
try {
  execFileSync('pnpm', ['--filter', '@vibelog/core', 'pack', '--pack-destination', directory], { stdio: 'inherit' });
  const archive = (await readdir(directory)).find((name) => name.endsWith('.tgz'));
  assert(archive, 'Core tarball is missing');
  const entries = run('tar', ['-tf', archive], { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n');
  for (const entry of entries) {
    assert(/^package\/(?:dist\/|template\/|README\.md$|LICENSE$|package\.json$)/.test(entry), `Unexpected packed file: ${entry}`);
    assert(!/(?:^|\/)(?:node_modules|tests?|\.env[^/]*|\.git)(?:\/|$)/.test(entry), `Private or test file packed: ${entry}`);
  }
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/migration-v1.js', 'dist/core/render-worker.js', 'dist/core/math-plugins.js', 'dist/core/math-plugins.json', 'dist/THIRD_PARTY_NOTICES.txt', 'template/package.json', 'template/src/pages/index.astro', 'LICENSE']) assert(entries.includes(`package/${file}`), `Missing packed asset: ${file}`);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, archive)]);
  const core = join(directory, 'node_modules/@vibelog/core');
  const pkg = JSON.parse(await readFile(join(core, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.exports), ['.', './migration-v1']);
  assert(!pkg.dependencies['remark-math'] && !pkg.dependencies['rehype-katex']);
  assert(!JSON.stringify(pkg.dependencies).includes('workspace:'));
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  assert(!lock.packages[''].overrides);
  for (const [path, dependency] of Object.entries(lock.packages)) {
    assert(!dependency.link, `Workspace link found: ${path}`);
    if (path.endsWith('/katex')) assert.equal(dependency.version, '0.18.2');
    assert(!path.endsWith('/braces'), 'Build-only braces installed in consumer');
  }
  for (const file of ['dist/core/math-plugins.js', 'dist/core/math-plugins.json', 'dist/THIRD_PARTY_NOTICES.txt']) {
    assert(!/\/Users\/|\/home\/runner\/|\/private\/tmp\//.test(await readFile(join(core, file), 'utf8')), `Local path in ${file}`);
  }
  const notices = await readFile(join(core, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert(notices.includes('katex@0.18.2') && notices.includes('remark-math@6.0.0') && notices.includes('rehype-katex@7.0.1'));
  const mathSmoke = await readFile(new URL('../../packages/core/scripts/math-bundle-smoke.mjs', import.meta.url), 'utf8');
  run(process.execPath, ['--input-type=module', '--eval', mathSmoke, pathToFileURL(join(core, 'dist/index.js')).href]);
  await writeFile(join(directory, 'consumer.mjs'), await readFile(new URL('./core-pack-consumer.mjs', import.meta.url)));
  run(process.execPath, ['consumer.mjs']);
  // Google SDK declarations referenced by pi-ai require their optional MCP peer.
  // Install it explicitly for strict type checking, without changing core's runtime.
  run('npm', ['install', '--save-dev', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@7.0.2', '@types/node@24', '@modelcontextprotocol/sdk@1.32.1']);
  await writeFile(join(directory, 'consumer.ts'), `
import { DEFAULT_DESIGN_V2, validateBlogDesignSpecV2, blogDesignSpecV2Schema, compileDesignCss, type BlogDesignSpecV2, type AiProvider, type ContentSource } from '@vibelog/core';
import { migratePersistedDesignToV2 } from '@vibelog/core/migration-v1';
import { z } from 'zod';
const design: BlogDesignSpecV2 = validateBlogDesignSpecV2(DEFAULT_DESIGN_V2);
const css: string = compileDesignCss(design);
const schema = z.object({ design: blogDesignSpecV2Schema });
type Input = Parameters<AiProvider['generate']>[0];
const source: ContentSource | undefined = undefined;
void [css, schema, source, migratePersistedDesignToV2];
const prompt: Input['prompt'] = 'A readable blog'; void prompt;
`);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts']);
  let audit;
  try { audit = run('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (error) { if (error.status !== 1 || !error.stdout) throw error; audit = error.stdout; }
  const report = JSON.parse(audit);
  assert(!report.error, 'Standalone npm audit failed');
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const advisories = vulnerability.via.filter((item) => typeof item === 'object');
    console.log(`Standalone audit: ${name} (${vulnerability.severity}) ${advisories.map((item) => item.url).join(' ')}`);
    assert(advisories.every((item) => item.url === 'https://github.com/advisories/GHSA-hp3w-g68c-fv3c'), `New standalone advisory in ${name}; review before release`);
  }
  console.log('Packed @vibelog/core installation, assets, browser-independent math and TypeScript consumer passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
