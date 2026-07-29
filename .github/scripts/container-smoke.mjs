import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const port = Number(process.env.PORT ?? 34123);
const image = process.env.VIBELOG_APP_IMAGE;
if (!image) throw new Error('VIBELOG_APP_IMAGE is required');

const docker = (args, options = {}) => {
  const output = execFileSync('docker', args, { encoding: 'utf8', ...options });
  return typeof output === 'string' ? output.trim() : '';
};
const inContainer = (source, capture = false) => docker(
  ['compose', 'exec', '-T', 'app', 'node', '--input-type=module'],
  { input: source, stdio: capture ? undefined : ['pipe', 'inherit', 'inherit'] },
);
const canRunInContainer = (source) => spawnSync(
  'docker',
  ['compose', 'exec', '-T', 'app', 'node', '--input-type=module'],
  { input: source, stdio: 'ignore' },
).status === 0;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function eventually(check, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error('Container smoke condition did not become true');
}

async function appIsHealthy() {
  try { return (await fetch(`http://127.0.0.1:${String(port)}/health`)).ok; }
  catch { return false; }
}

async function publicSiteContains(expected) {
  return await new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      headers: { host: `smoke.app.localtest.me:${String(port)}` },
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(response.statusCode === 200 && body.includes(expected)));
    });
    request.on('error', () => resolve(false));
  });
}

await eventually(appIsHealthy, 90);
if (docker(['image', 'inspect', image, '--format', '{{json .Config.Cmd}}']) !== '["node","dist/main.js"]') throw new Error('Unexpected image command');
if (inContainer("console.log(process.getuid())", true) === '0') throw new Error('Container runs as root');
inContainer(readFileSync('packages/app/tests/runtime-image-smoke.mjs', 'utf8'));

inContainer(`
  import { randomUUID } from 'node:crypto';
  import { mkdirSync, writeFileSync } from 'node:fs';
  import { AppDatabase } from './dist/database.js';
  import { user } from './dist/schema.js';

  const db = new AppDatabase('/data');
  const userId = randomUUID();
  const at = new Date();
  db.db.insert(user).values({
    id: userId, name: 'smoke', email: 'smoke@users.vibelog.invalid', emailVerified: false,
    username: 'smoke', displayUsername: 'smoke', createdAt: at, updatedAt: at,
  }).run();
  const { blog, operation } = db.createBlog(userId, 'smoke', 'smoke');
  db.completeOperation(operation.id);
  const root = '/data/blogs/' + userId + '/' + blog.id;
  const draft = root + '/drafts/' + randomUUID();
  mkdirSync(draft, { recursive: true });
  writeFileSync(draft + '/index.html', '<h1>Smoke published</h1>');
  db.completeSync(blog.id, { title: 'Smoke', description: 'Smoke', author: 'Smoke', draftArtifact: draft });
  const theme = db.getActiveTheme(blog.id);
  if (!theme) throw new Error('Theme missing');
  db.createPreviewSession('smoke-preview', userId, blog.id, '2099-01-01T00:00:00.000Z', theme.config);
  const publish = db.createPublishOperation(userId, blog.id, 'smoke-preview');
  writeFileSync('/data/smoke-operation', publish.id);
  writeFileSync('/data/smoke-storage.json', JSON.stringify({ blogId: blog.id, root, draft }));
  db.close();
`);

await eventually(() => canRunInContainer(`
  import { readFileSync } from 'node:fs';
  import { AppDatabase } from './dist/database.js';
  const db = new AppDatabase('/data');
  const id = readFileSync('/data/smoke-operation', 'utf8');
  const row = db.connection.prepare('SELECT status FROM operations WHERE id = ?').get(id);
  db.close();
  if (row?.status !== 'succeeded') process.exit(1);
`));
await eventually(() => publicSiteContains('Smoke published'));

inContainer(`
  import { randomUUID } from 'node:crypto';
  import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  const state = JSON.parse(readFileSync('/data/smoke-storage.json', 'utf8'));
  state.orphans = [
    state.root + '/.sync-' + randomUUID(),
    state.root + '/drafts/' + randomUUID(),
    state.root + '/releases/.staging-' + randomUUID(),
    state.root + '/releases/' + randomUUID(),
  ];
  for (const path of [...state.orphans, state.root + '/keep-me']) mkdirSync(path, { recursive: true });
  writeFileSync('/data/smoke-storage.json', JSON.stringify(state));
  writeFileSync('/data/persistence-smoke', 'ok');
`);
docker(['compose', 'restart', 'app'], { stdio: 'inherit' });
await eventually(appIsHealthy, 90);

inContainer(`
  import { readFileSync } from 'node:fs';
  if (readFileSync('/data/persistence-smoke', 'utf8') !== 'ok') process.exit(1);
`);
await eventually(() => canRunInContainer(`
  import { existsSync, readFileSync } from 'node:fs';
  import { AppDatabase } from './dist/database.js';
  const state = JSON.parse(readFileSync('/data/smoke-storage.json', 'utf8'));
  const db = new AppDatabase('/data');
  const release = db.getActiveRelease(state.blogId);
  db.close();
  if (!release || !existsSync(state.draft) || !existsSync(release.artifact)
    || !existsSync(state.root + '/keep-me') || state.orphans.some(existsSync)) process.exit(1);
`));
await eventually(() => publicSiteContains('Smoke published'));

const containerId = docker(['compose', 'ps', '--all', '--quiet', 'app']);
docker(['compose', 'stop', '--timeout', '30', 'app'], { stdio: 'inherit' });
if (docker(['inspect', containerId, '--format', '{{.State.ExitCode}}']) !== '0') throw new Error('Container did not stop cleanly');
