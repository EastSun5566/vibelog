import { Hono } from 'hono';
import { CloudTasksRequestVerifier, LocalTaskRequestVerifier } from './adapters/cloud-tasks-request-verifier.js';
import { handleOperationTask } from './adapters/cloud-tasks-transport.js';
import { loadWorkerConfig } from './config.js';
import { createWorkerRuntimeDependencies } from './runtime-dependencies.js';
import { closeHttpServer, startHttpServer } from './server-runtime.js';

const config = loadWorkerConfig(); const dependencies = createWorkerRuntimeDependencies(config);
const verifier = config.taskQueueName ? new CloudTasksRequestVerifier(config.taskQueueName) : new LocalTaskRequestVerifier();
const app = new Hono();
app.get('/health', async (c) => { await dependencies.database.ping(); return c.json({ status: 'ok', service: 'vibelog-worker' }); });
app.post('/tasks/operations', (c) => handleOperationTask(c.req.raw, verifier, dependencies.executor));
app.post('/tasks/outbox', async (c) => c.json({ dispatched: await dependencies.dispatcher.dispatch() }));
app.post('/tasks/maintenance', async (c) => c.json({ removed: await dependencies.executor.cleanupPending() }));
const server = startHttpServer(app.fetch);
const pollController = new AbortController();
const polling = 'durableWorker' in dependencies
  ? pollOutbox(dependencies.durableWorker, dependencies.executor.cleanupPending.bind(dependencies.executor), pollController.signal, config.operationPollIntervalMs)
  : Promise.resolve();
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> { if (shuttingDown) return; shuttingDown = true; console.log(`Received ${signal}; stopping VibeLog worker`); pollController.abort(); await closeHttpServer(server); await polling; await dependencies.database.close(); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(signal).catch((error: unknown) => { console.error('Worker shutdown failed', error); process.exitCode = 1; }); });

async function pollOutbox(dispatcher: { dispatch(limit?: number): Promise<number> }, cleanup: () => Promise<number>, signal: AbortSignal, intervalMs: number): Promise<void> {
  let lastMaintenance = 0;
  while (!signal.aborted) {
    let completed = 0;
    try {
      completed = await dispatcher.dispatch(1);
      if (Date.now() - lastMaintenance >= 5 * 60 * 1000) { await cleanup(); lastMaintenance = Date.now(); }
    } catch (error) { console.error('PostgreSQL operation worker failed; retrying', error); }
    if (completed === 0) await waitForNextPoll(signal, intervalMs);
  }
}

async function waitForNextPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timeout); signal.removeEventListener('abort', finish); resolve(); };
    const timeout = setTimeout(finish, intervalMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}
