// Actions only give these values to JavaScript actions; later run steps (Pulumi's docker-build
// provider) need them to use the gha cache, the same values docker/build-push-action reads itself.
import { appendFileSync } from 'node:fs';

const names = [
  'ACTIONS_CACHE_URL',
  'ACTIONS_RESULTS_URL',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_CACHE_SERVICE_V2',
];
for (const name of names) {
  const value = process.env[name];
  if (!value) continue;
  if (name === 'ACTIONS_RUNTIME_TOKEN') console.log(`::add-mask::${value}`);
  appendFileSync(process.env.GITHUB_ENV ?? '', `${name}=${value}\n`);
}
