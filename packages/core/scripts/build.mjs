import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
await import('./build-math.mjs');
const { generateBuildFingerprints } = await import('./build-fingerprints.mjs');
await generateBuildFingerprints(root);
console.log('Generated template and renderer fingerprints.');
