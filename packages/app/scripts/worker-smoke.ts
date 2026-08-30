import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

interface SmokeConfig { candidateUrl: string; audience: string; queuePath: string; invokerEmail: string; accessToken: string }
interface SmokeDatabase {
  query(text: string, values?: unknown[]): Promise<{ rows: { status?: string; attempts?: number }[] }>;
}

/** Exercise candidate transport, IAM, DB claim and terminal persistence without paid AI/content calls. */
export async function smokeWorker(config: SmokeConfig, database: SmokeDatabase, dependencies: { fetch?: typeof fetch; wait?: () => Promise<void>; polls?: number } = {}): Promise<void> {
  const request = dependencies.fetch ?? fetch;
  const wait = dependencies.wait ?? (() => setTimeout(2000));
  const userId = randomUUID(); const blogId = randomUUID(); const operationId = randomUUID();
  const taskName = `${config.queuePath}/tasks/smoke-${operationId}`;
  const api = 'https://cloudtasks.googleapis.com/v2/';
  const headers = { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' };
  let taskAttempted = false;
  const removeTask = async () => {
    if (!taskAttempted) return;
    const response = await request(`${api}${taskName}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok && response.status !== 404) throw new Error(`Worker smoke task cleanup failed (${String(response.status)})`);
  };
  try {
    // One statement is atomic. No outbox: only this candidate-targeted task may execute the fixture.
    await database.query(`with smoke_user as (
      insert into "user" (id, name, email) values ($1, 'Deployment smoke', $4) returning id
    ), smoke_blog as (
      insert into blogs (id, user_id, username, hackmd_username, state)
      select $2, id, $5, 'deployment-smoke', 'ready' from smoke_user returning id, user_id
    ) insert into operations (id, user_id, blog_id, type, status, payload)
      select $3, user_id, id, 'generate_theme', 'queued', '{}'::jsonb from smoke_blog`,
    [userId, blogId, operationId, `smoke-${userId}@example.invalid`, `smoke-${blogId.slice(0, 20)}`]);
    taskAttempted = true;
    const response = await request(`${api}${config.queuePath}/tasks`, {
      method: 'POST', headers, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ task: { name: taskName, dispatchDeadline: '60s', httpRequest: {
        httpMethod: 'POST', url: `${config.candidateUrl.replace(/\/$/, '')}/tasks/operations`,
        headers: { 'Content-Type': 'application/json' },
        oidcToken: { serviceAccountEmail: config.invokerEmail, audience: config.audience },
        body: Buffer.from(JSON.stringify({ version: 1, operationId, traceId: randomUUID(), createdAt: new Date().toISOString() })).toString('base64'),
      } } }),
    });
    if (!response.ok) throw new Error(`Worker smoke task creation failed (${String(response.status)})`);
    for (let poll = 0; poll < (dependencies.polls ?? 60); poll += 1) {
      const { rows: [operation] } = await database.query('select status, attempts from operations where id = $1', [operationId]);
      if (operation?.status === 'failed' && operation.attempts === 1) return;
      if (!operation || operation.status === 'succeeded' || (operation.attempts ?? 0) > 1) throw new Error('Worker smoke produced an unexpected result');
      await wait();
    }
    throw new Error('Candidate worker did not persist the expected terminal result in time');
  } finally {
    try {
      await removeTask();
    } finally {
      await database.query('delete from "user" where id = $1', [userId]);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
  const database = new Pool({ connectionString: required('DATABASE_MIGRATION_URL'), max: 1, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  try {
    await smokeWorker({ candidateUrl: required('WORKER_SMOKE_URL'), audience: required('WORKER_AUDIENCE'), queuePath: required('CLOUD_TASKS_QUEUE_PATH'), invokerEmail: required('CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL'), accessToken: required('GOOGLE_OAUTH_ACCESS_TOKEN') }, database);
    console.log('Candidate worker smoke passed: authenticated delivery, claim and terminal persistence.');
  } catch {
    // Do not print provider/DB errors, which can contain credentials or connection URLs.
    console.error('Candidate worker smoke failed; traffic promotion is blocked. Inspect worker logs and deployment identity permissions.');
    process.exitCode = 1;
  } finally { await database.end(); }
}
