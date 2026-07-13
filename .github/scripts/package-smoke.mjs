import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const scratch = await mkdtemp(join(tmpdir(), 'vibelog-package-smoke-'));
const packs = join(scratch, 'packs');
const consumer = join(scratch, 'consumer');
await mkdir(packs);

function run(command, args, cwd = repository) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

run('pnpm', ['--filter', '@vibelog/core', 'pack', '--pack-destination', packs]);
run('pnpm', ['--filter', 'vibelog', 'pack', '--pack-destination', packs]);

const corePackage = JSON.parse(await readFile(join(repository, 'packages/core/package.json'), 'utf8'));
const cliPackage = JSON.parse(await readFile(join(repository, 'packages/cli/package.json'), 'utf8'));
const corePack = join(packs, `vibelog-core-${corePackage.version}.tgz`);
const cliPack = join(packs, `vibelog-${cliPackage.version}.tgz`);
await writeFile(join(scratch, 'package.json'), JSON.stringify({
  private: true,
  dependencies: {
    '@vibelog/core': `file:${corePack}`,
    vibelog: `file:${cliPack}`,
  },
  pnpm: {
    overrides: {
      '@vibelog/core': `file:${corePack}`,
    },
  },
}));
run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], scratch);
run('node', [join(scratch, 'node_modules/vibelog/dist/index.js'), '--help'], scratch);

await cp(join(repository, 'tests/fixtures/content'), join(consumer, 'content'), { recursive: true });
const cli = join(scratch, 'node_modules/vibelog/dist/index.js');
const port = 45678;
const dev = spawn(process.execPath, [cli, 'dev', '--root', consumer, '--content', `fs@${join(consumer, 'content')}`, '--ai', 'ollama@smoke', '--port', String(port), '--no-install'], {
  cwd: scratch,
  stdio: 'inherit',
  env: process.env,
});
const devExit = new Promise((resolve) => dev.once('exit', resolve));

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
  }
  if (!ready) throw new Error('Packaged CLI dev server did not become ready');
} finally {
  if (dev.exitCode === null) dev.kill('SIGTERM');
  await devExit;
}

run('node', [cli, 'build', '--root', consumer, '--out-dir', 'dist', '--site-url', 'https://example.com'], scratch);
const html = await readFile(join(consumer, 'dist/index.html'), 'utf8');
if (!html.includes('Test Author')) throw new Error('Packaged CLI fixture output is invalid');
