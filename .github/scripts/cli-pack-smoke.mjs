import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'vibelog-cli-pack-'));
try {
  execFileSync('pnpm', ['--filter', '@vibelog/cli', 'pack', '--pack-destination', directory], { stdio: 'inherit' });
  const file = (await readdir(directory)).find((name) => name.endsWith('.tgz'));
  assert(file, 'CLI tarball is missing');
  execFileSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund', join(directory, file)], { stdio: 'inherit' });
  const pkg = JSON.parse(await readFile(join(directory, 'node_modules/@vibelog/cli/package.json'), 'utf8'));
  assert.equal(pkg.name, '@vibelog/cli');
  const binary = join(directory, 'node_modules/@vibelog/cli/dist/main.js');
  const help = execFileSync('node', [binary, '--help'], { encoding: 'utf8' });
  assert(help.includes('@vibelog/cli'));
  assert(!JSON.stringify(pkg.dependencies).includes('workspace:'));
  console.log('Packed @vibelog/cli installation and help passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
