import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function waitForCoreRelease(version, { timeoutMs = 600_000, intervalMs = 15_000 } = {}) {
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch('https://registry.npmjs.org/@vibelog%2fcore', {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
    });
    if (response.ok) {
      const metadata = await response.json();
      const dist = metadata.versions?.[version]?.dist;
      if (metadata['dist-tags']?.beta === version && dist?.integrity && dist.attestations?.provenance) return;
    } else if (response.status !== 404) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await setTimeout(Math.min(intervalMs, remaining));
  }
  throw new Error(`Timed out waiting for @vibelog/core@${version} beta metadata and provenance`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForCoreRelease(process.env.CORE_VERSION ?? '');
  console.log(`@vibelog/core@${process.env.CORE_VERSION} is available; verifying the published tarball next.`);
}
