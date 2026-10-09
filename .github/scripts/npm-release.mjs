import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const channels = { core: 'beta', cli: 'latest' };

export function checkNpmRelease(slug, tag, pkg) {
  assert(Object.hasOwn(channels, slug), 'Only core and CLI can be published');
  assert.match(tag, /^(?:core|cli)-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  assert.equal(tag, `${slug}-v${pkg.version}`, 'Tag must match the package version');
  assert.equal(pkg.name, `@vibelog/${slug}`);
  assert.notEqual(pkg.private, true);
  assert.deepEqual(pkg.publishConfig, { access: 'public', tag: channels[slug], registry: 'https://registry.npmjs.org' });
  return { name: pkg.name, version: pkg.version, distTag: channels[slug] };
}

export function verifyNpmRelease(release, before, dist, tags, archive) {
  assert.equal(tags[release.distTag], release.version);
  assert.deepEqual(Object.keys(tags).sort(), [...new Set([...Object.keys(before), release.distTag])].sort(), 'Only the release dist-tag may be added');
  for (const [tag, version] of Object.entries(before)) {
    if (tag !== release.distTag) assert.equal(tags[tag], version, `Existing ${tag} must not change`);
  }
  assert.equal(dist.integrity, `sha512-${createHash('sha512').update(archive).digest('base64')}`);
  assert(dist.attestations?.provenance, 'Published package must have npm provenance');
}

export function npmJson(value) {
  if (!Array.isArray(value)) return value;
  assert.equal(value.length, 1, 'Expected exactly one npm package result');
  return value[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, slug] = process.argv.slice(2);
  assert(Object.hasOwn(channels, slug), 'Only core and CLI can be published');
  const pkg = JSON.parse(readFileSync(`packages/${slug}/package.json`, 'utf8'));
  const release = checkNpmRelease(slug, process.env.GITHUB_REF_NAME ?? '', pkg);
  if (command === 'check') {
    const [major, minor, patch] = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim().split('.').map(Number);
    assert(major > 11 || major === 11 && (minor > 5 || minor === 5 && patch >= 1), 'Trusted publishing requires npm >=11.5.1');
    appendFileSync(process.env.GITHUB_ENV, [
      `RELEASE_PACKAGE=${release.name}`,
      `RELEASE_VERSION=${release.version}`,
      `RELEASE_DIST_TAG=${release.distTag}`,
      `RELEASE_TARBALL=${join(process.env.RUNNER_TEMP, 'npm-release', `vibelog-${slug}-${release.version}.tgz`)}`,
    ].join('\n') + '\n');
  } else {
    assert.equal(command, 'verify');
    const json = (file) => npmJson(JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, file), 'utf8')));
    verifyNpmRelease(release, json('npm-tags-before.json'), json('npm-dist.json'), json('npm-tags-after.json'), readFileSync(process.env.RELEASE_TARBALL));
    console.log(`${release.name}@${release.version}: dist-tag, integrity, provenance and other tags verified.`);
  }
}
