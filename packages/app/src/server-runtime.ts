import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';

type FetchCallback = Parameters<typeof serve>[0]['fetch'];

export function startHttpServer(fetch: FetchCallback, env: NodeJS.ProcessEnv = process.env): ServerType {
  const port = Number.parseInt(env.PORT ?? '3000', 10);
  const hostname = env.HOST ?? '127.0.0.1';

  console.log(`VibeLog SaaS listening on http://${hostname}:${String(port)}`);

  return serve({ fetch, port, hostname });
}

export async function closeHttpServer(server: ServerType): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
