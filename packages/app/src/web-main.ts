import { loadAppConfig } from './config.js';
import { createApp } from './index.js';
import { createWebRuntimeDependencies } from './runtime-dependencies.js';
import { closeHttpServer, startHttpServer } from './server-runtime.js';

const config = loadAppConfig();
const dependencies = createWebRuntimeDependencies(config);
const { app } = createApp({ config, ...dependencies });
const server = startHttpServer(app.fetch);
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`Received ${signal}; stopping VibeLog web`);
  await closeHttpServer(server); await dependencies.database.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(signal).catch((error: unknown) => { console.error('Web shutdown failed', error); process.exitCode = 1; }); });
