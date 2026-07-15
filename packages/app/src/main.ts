import { loadAppConfig } from './config.js';
import { AppDatabase } from './database.js';
import { createApp } from './index.js';
import { JobWorker } from './jobs.js';
import { startCombinedRuntime } from './runtime.js';
import { startHttpServer } from './server-runtime.js';

const config = loadAppConfig();
const database = new AppDatabase(config.dataRoot);
const { app } = createApp({ config, database });
const worker = new JobWorker(database, config);
const server = startHttpServer(app.fetch);
const runtime = startCombinedRuntime({ server, worker, database });

const signalHandlers = new Map<NodeJS.Signals, () => void>();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  const handler = (): void => { void runtime.shutdown(signal); };
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

try {
  await runtime.done;
} catch (error) {
  console.error('VibeLog combined runtime stopped with an error', error);
  process.exitCode = 1;
} finally {
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
}
