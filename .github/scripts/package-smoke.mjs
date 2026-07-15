import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const registryFlag = process.argv.indexOf('--registry-version');
if (registryFlag !== -1 && !process.argv[registryFlag + 1]) {
  throw new Error('--registry-version requires an exact version');
}
if (process.argv.length !== (registryFlag === -1 ? 2 : 4)) {
  throw new Error('Usage: node package-smoke.mjs [--registry-version <version>]');
}

const registryVersion = registryFlag === -1 ? undefined : process.argv[registryFlag + 1];
const scratch = await mkdtemp(join(tmpdir(), 'vibelog-package-smoke-'));
const packs = join(scratch, 'packs');
const consumer = join(scratch, 'consumer');
await mkdir(packs);

function run(command, args, cwd = repository) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function capture(command, args, cwd = repository) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

const corePackage = JSON.parse(await readFile(join(repository, 'packages/core/package.json'), 'utf8'));
const cliPackage = JSON.parse(await readFile(join(repository, 'packages/cli/package.json'), 'utf8'));
const expectedVersion = registryVersion ?? cliPackage.version;
let dependencies;

if (registryVersion) {
  dependencies = { vibelog: registryVersion };
} else {
  if (corePackage.version !== cliPackage.version) {
    throw new Error('Local core and CLI versions must match');
  }
  run('pnpm', ['--filter', '@vibelog/core', 'pack', '--pack-destination', packs]);
  run('pnpm', ['--filter', 'vibelog', 'pack', '--pack-destination', packs]);

  const corePack = join(packs, `vibelog-core-${corePackage.version}.tgz`);
  const cliPack = join(packs, `vibelog-${cliPackage.version}.tgz`);
  const packedCliPackage = JSON.parse(capture('tar', ['-xOf', cliPack, 'package/package.json']));
  if (packedCliPackage.dependencies?.['@vibelog/core'] !== corePackage.version) {
    throw new Error('pnpm pack did not convert @vibelog/core workspace:* to the exact version');
  }

  dependencies = {
    '@vibelog/core': `file:${corePack}`,
    vibelog: `file:${cliPack}`,
  };
}

await writeFile(join(scratch, 'package.json'), JSON.stringify({
  private: true,
  dependencies,
  ...(registryVersion ? {} : {
    pnpm: {
      overrides: {
        '@vibelog/core': dependencies['@vibelog/core'],
      },
    },
  }),
}));
run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], scratch);

const installedCliPackage = JSON.parse(await readFile(join(scratch, 'node_modules/vibelog/package.json'), 'utf8'));
const installedCorePackage = JSON.parse(await readFile(join(scratch, 'node_modules/@vibelog/core/package.json'), 'utf8'));
if (installedCliPackage.version !== expectedVersion || installedCorePackage.version !== expectedVersion) {
  throw new Error(`Expected CLI and core ${expectedVersion}, got CLI ${installedCliPackage.version} and core ${installedCorePackage.version}`);
}
if (installedCliPackage.dependencies?.['@vibelog/core'] !== expectedVersion) {
  throw new Error(`Installed CLI does not require @vibelog/core ${expectedVersion}`);
}

const cli = join(scratch, 'node_modules/vibelog/dist/index.js');
run('node', [cli, '--help'], scratch);
const reportedVersion = capture('node', [cli, '--version'], scratch);
if (reportedVersion.split(' ')[0] !== `vibelog/v${expectedVersion}`) {
  throw new Error(`Expected CLI to report vibelog/v${expectedVersion}, got ${reportedVersion}`);
}

await cp(join(repository, 'packages/core/tests/fixtures/content'), join(consumer, 'content'), { recursive: true });
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

console.log(`Package smoke test passed for vibelog@${expectedVersion} (${registryVersion ? 'registry' : 'local tarballs'})`);
