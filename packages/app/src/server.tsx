import { createApp } from './index.js';
import { closeHttpServer, startHttpServer } from './server-runtime.js';

const { app, database } = createApp();
const server = startHttpServer(app.fetch);

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping VibeLog SaaS`);
  void closeHttpServer(server).then(() => {
    database.close();
  }, (error: unknown) => {
    database.close();
    console.error(error);
    process.exitCode = 1;
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { shutdown(signal); });
}
