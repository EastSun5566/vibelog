import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkCoreRelease(tag, pkg) {
  assert.match(tag, /^core-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  assert.equal(tag, `core-v${pkg.version}`, 'Tag must match the core package version');
  assert.equal(pkg.name, '@vibelog/core');
  assert.notEqual(pkg.private, true);
  assert.deepEqual(pkg.publishConfig, { access: 'public', tag: 'beta', registry: 'https://registry.npmjs.org' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkCoreRelease(process.env.TAG ?? '', JSON.parse(readFileSync('packages/core/package.json', 'utf8')));
}
