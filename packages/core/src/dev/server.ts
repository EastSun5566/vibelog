import { dev as createAstroDevServer } from 'astro';
import type { AstroIntegration } from 'astro';
import { join } from 'node:path';

import { StyleTransformer } from '../core/index.js';
import { createPanelScript } from './ui.js';
import { handleTransformStyle, handleError, parseBody } from './middlewares.js';

// Infer DevServer type from the dev() function return type
type DevServer = Awaited<ReturnType<typeof createAstroDevServer>>;

interface VibelogOptions {
  vibelogDir: string;
  styleTransformer: StyleTransformer;
}
function vibelog({ vibelogDir, styleTransformer }: VibelogOptions): AstroIntegration {
  return {
    name: 'vibelog-dev',
    hooks: {
      'astro:config:setup': ({ injectScript }) => {
        injectScript('page', createPanelScript());
      },
      'astro:server:setup': ({ server, ...options }) => {
        server.middlewares
          .use(parseBody())
          .use('/_vibe/transform', handleTransformStyle({ vibelogDir, styleTransformer, server, ...options }))
          .use(handleError());
      },
    },
  };
}

export interface DevServerOptions {
  root: string;
  port?: number;
  styleTransformer: StyleTransformer;
}
export async function createDevServer({
  root,
  port = 5566,
  styleTransformer,
}: DevServerOptions): Promise<DevServer> {
  const server = await createAstroDevServer({
    root,
    cacheDir: join(root, '.astro'),
    server: { port },
    site: `http://localhost:${String(port)}`,
    devToolbar: {
      enabled: false,
    },
    integrations: [vibelog({ vibelogDir: root, styleTransformer })],
  });

  return server;
}
