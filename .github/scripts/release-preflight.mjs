import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const verify = process.argv.includes('--verify');
if (process.argv.length !== (verify ? 3 : 2)) {
  throw new Error('Usage: node release-preflight.mjs [--verify]');
}

async function manifest(path) {
  return JSON.parse(await readFile(resolve(repository, path), 'utf8'));
}

const [rootPackage, corePackage, cliPackage, appPackage] = await Promise.all([
  manifest('package.json'),
  manifest('packages/core/package.json'),
  manifest('packages/cli/package.json'),
  manifest('packages/app/package.json'),
]);
const version = rootPackage.version;

if (corePackage.version !== version || cliPackage.version !== version) {
  throw new Error(`Root, core, and CLI versions must match (root=${version}, core=${corePackage.version}, cli=${cliPackage.version})`);
}
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  throw new Error(`Release version must be a beta prerelease, got ${version}`);
}
if (appPackage.private !== true) {
  throw new Error('@vibelog/app must be private');
}

const registry = 'https://registry.npmjs.org';
const packages = ['@vibelog/core', 'vibelog'];

async function registryVersionExists(name) {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`npm registry returned ${response.status} for ${name}@${version}`);
}

async function packument(name) {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}

async function retry(task, label) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

if (verify) {
  await retry(async () => {
    const existence = await Promise.all(packages.map(registryVersionExists));
    if (existence.some((exists) => !exists)) {
      throw new Error(`Not all packages are published at ${version}`);
    }
    const [coreData, cliData] = await Promise.all(packages.map(packument));
    if (coreData['dist-tags']?.beta !== version) {
      throw new Error(`@vibelog/core@beta is ${coreData['dist-tags']?.beta ?? 'missing'}, expected ${version}`);
    }
    if (cliData['dist-tags']?.beta !== version) {
      throw new Error(`vibelog@beta is ${cliData['dist-tags']?.beta ?? 'missing'}, expected ${version}`);
    }
    if (cliData['dist-tags']?.latest !== '0.3.4') {
      throw new Error(`vibelog@latest is ${cliData['dist-tags']?.latest ?? 'missing'}, expected 0.3.4`);
    }
  }, 'Published package verification failed');
  console.log(`Verified npm packages and dist-tags for ${version}`);
} else {
  const [coreExists, cliExists] = await Promise.all(packages.map(registryVersionExists));
  const result = { version, coreExists, cliExists };
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `version=${version}`,
      `core_exists=${coreExists}`,
      `cli_exists=${cliExists}`,
      '',
    ].join('\n'));
  }
}
