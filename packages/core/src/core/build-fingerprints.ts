import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyFingerprint, fingerprintEntries } from './fingerprint-inputs.js';

interface FingerprintManifest {
  version: 1;
  template: string;
  source: string;
  dependencies: string[];
  renderer: string;
}

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'dist/core/build-fingerprints.json'), 'utf8'),
) as FingerprintManifest;
if (
  manifest.version !== 1 ||
  ![manifest.template, manifest.source, manifest.renderer].every(
    (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
  ) ||
  !Array.isArray(manifest.dependencies) ||
  !manifest.dependencies.length ||
  !manifest.dependencies.every(
    (value) => typeof value === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(value),
  )
)
  throw new Error('Invalid renderer fingerprints; rebuild @vibelog/core');

export const templateFingerprint = manifest.template;
export const rendererFingerprint = fingerprintEntries([
  ['template', manifest.template],
  ['source', manifest.source],
  ['dependencies', dependencyFingerprint(packageRoot, manifest.dependencies)],
]);
