import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function waitForNpmRelease(name, version, distTag, { timeoutMs = 600_000, intervalMs = 15_000 } = {}) {
  assert(['@vibelog/core', '@vibelog/cli'].includes(name));
  assert.equal(distTag, name === '@vibelog/core' ? 'beta' : 'latest');
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
    });
    if (response.ok) {
      const metadata = await response.json();
      const dist = metadata.versions?.[version]?.dist;
      if (metadata['dist-tags']?.[distTag] === version && dist?.integrity && dist.attestations?.provenance) return;
    } else if (response.status !== 404) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await setTimeout(Math.min(intervalMs, remaining));
  }
  throw new Error(`Timed out waiting for ${name}@${version} ${distTag} metadata and provenance`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForNpmRelease(process.env.RELEASE_PACKAGE ?? '', process.env.RELEASE_VERSION ?? '', process.env.RELEASE_DIST_TAG ?? '');
  console.log(`${process.env.RELEASE_PACKAGE}@${process.env.RELEASE_VERSION} is available; verifying the published tarball next.`);
}
