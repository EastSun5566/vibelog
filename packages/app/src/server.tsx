import { serve } from '@hono/node-server';
import { createApp } from './index.js';

const { app, database } = createApp();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOST ?? '127.0.0.1';

console.log(`VibeLog SaaS listening on http://${hostname}:${String(port)}`);

const server = serve({
  fetch: app.fetch,
  port,
  hostname,
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping VibeLog SaaS`);
  server.close((error) => {
    database.close();
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { shutdown(signal); });
}
