import { execFileSync } from 'node:child_process';

const port = Number(process.env.PORT ?? 34123);
const image = process.env.VIBELOG_APP_IMAGE;
if (!image) throw new Error('VIBELOG_APP_IMAGE is required');

const docker = (args, options = {}) => {
  const output = execFileSync('docker', args, {
    encoding: 'utf8',
    ...options,
  });
  return typeof output === 'string' ? output.trim() : '';
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function eventually(check, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error('Container smoke condition did not become true');
}

async function webIsHealthy() {
  try {
    return (await fetch(`http://127.0.0.1:${String(port)}/health`)).ok;
  } catch {
    return false;
  }
}

await eventually(webIsHealthy);

const workerUserId = '00000000-0000-4000-8000-000000000101';
const workerBlogId = '00000000-0000-4000-8000-000000000102';
const workerOperationId = '00000000-0000-4000-8000-000000000103';
const workerOutboxId = '00000000-0000-4000-8000-000000000104';
docker([
  'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'vibelog', '-d', 'vibelog',
  '-v', 'ON_ERROR_STOP=1', '-c',
  `INSERT INTO "user" (id, name, email) VALUES ('${workerUserId}', 'Worker Smoke', 'worker-smoke@example.com');
   INSERT INTO blogs (id, user_id, username, hackmd_username, state) VALUES ('${workerBlogId}', '${workerUserId}', 'worker-smoke', 'worker-smoke', 'ready');
   INSERT INTO operations (id, user_id, blog_id, type, status, payload) VALUES ('${workerOperationId}', '${workerUserId}', '${workerBlogId}', 'generate_theme', 'queued', '{}');
   INSERT INTO operation_outbox (id, operation_id, payload) VALUES ('${workerOutboxId}', '${workerOperationId}', jsonb_build_object('version', 1, 'operationId', '${workerOperationId}', 'traceId', 'container-smoke', 'createdAt', now()::text));`,
]);
await eventually(() => docker([
  'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'vibelog', '-d', 'vibelog', '-tAc',
  `SELECT operations.status || '|' || (operation_outbox.dispatched_at IS NOT NULL)::text FROM operations JOIN operation_outbox ON operation_outbox.operation_id = operations.id WHERE operations.id = '${workerOperationId}'`,
]) === 'failed|true');
docker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'vibelog', '-d', 'vibelog', '-c', `DELETE FROM "user" WHERE id = '${workerUserId}'`]);

if (docker(['image', 'inspect', image, '--format', '{{json .Config.Cmd}}']) !== '["node","dist/web-main.js"]') {
  throw new Error('Unexpected image command');
}
const volumes = docker(['image', 'inspect', image, '--format', '{{json .Config.Volumes}}']);
if (volumes !== 'null' && volumes.includes('/data')) throw new Error('Image declares a persistent /data volume');
if (docker(['compose', 'exec', '-T', 'web', 'node', '-p', 'process.getuid()']) === '0') {
  throw new Error('Web container runs as root');
}
docker(['compose', 'exec', '-T', 'web', 'node', '-e', "if (require('node:fs').existsSync('/data')) process.exit(1)"]);

docker([
  'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'vibelog', '-d', 'vibelog',
  '-v', 'ON_ERROR_STOP=1', '-c',
  "CREATE TABLE IF NOT EXISTS container_smoke (id text PRIMARY KEY); INSERT INTO container_smoke VALUES ('external-state') ON CONFLICT DO NOTHING;",
]);
docker([
  'compose', 'run', '--rm', '--no-deps', '--entrypoint', '/bin/sh', 'minio-init', '-c',
  "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && printf external-object | mc pipe local/vibelog/container-smoke/marker >/dev/null",
]);

docker(['compose', 'restart', 'web', 'worker'], { stdio: 'inherit' });
await eventually(webIsHealthy);

const databaseMarker = docker([
  'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'vibelog', '-d', 'vibelog',
  '-tAc', "SELECT id FROM container_smoke WHERE id = 'external-state'",
]);
if (databaseMarker !== 'external-state') throw new Error('PostgreSQL state did not survive app container restart');

const objectMarker = docker([
  'compose', 'run', '--rm', '--no-deps', '--entrypoint', '/bin/sh', 'minio-init', '-c',
  "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && mc cat local/vibelog/container-smoke/marker",
]);
if (objectMarker !== 'external-object') throw new Error('Object state did not survive app container restart');

const containerId = docker(['compose', 'ps', '--all', '--quiet', 'web']);
docker(['compose', 'stop', '--timeout', '30', 'web'], { stdio: 'inherit' });
if (docker(['inspect', containerId, '--format', '{{.State.ExitCode}}']) !== '0') {
  throw new Error('Web container did not stop cleanly');
}
