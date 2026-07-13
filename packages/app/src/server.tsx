import { serve } from '@hono/node-server';
import { createApp } from './index.js';

const { app } = createApp();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOST ?? '127.0.0.1';

console.log(`VibeLog SaaS listening on http://${hostname}:${String(port)}`);

serve({
  fetch: app.fetch,
  port,
  hostname,
});
