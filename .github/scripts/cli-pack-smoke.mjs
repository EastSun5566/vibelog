import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'vibelog-cli-pack-'));
try {
  if (!process.argv[2]) execFileSync('pnpm', ['--filter', '@vibelog/cli', 'pack', '--pack-destination', directory], { stdio: 'inherit' });
  const archive = process.argv[2] ? resolve(process.argv[2]) : join(directory, (await readdir(directory)).find((name) => name.endsWith('.tgz')) ?? '');
  assert(archive.endsWith('.tgz'), 'CLI tarball is missing');
  execFileSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund', archive], { stdio: 'inherit' });
  const pkg = JSON.parse(await readFile(join(directory, 'node_modules/@vibelog/cli/package.json'), 'utf8'));
  assert.equal(pkg.name, '@vibelog/cli');
  const binary = join(directory, 'node_modules/@vibelog/cli/dist/main.js');
  const help = execFileSync('node', [binary, '--help'], { encoding: 'utf8' });
  assert(help.includes('@vibelog/cli'));
  assert(help.includes(`VibeLog CLI ${pkg.version}`));
  assert(help.includes('--allow-publish') && help.includes('|publish --file'));
  assert(!JSON.stringify(pkg.dependencies).includes('workspace:'));
  console.log('Packed @vibelog/cli installation and help passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
