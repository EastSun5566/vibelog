import { dev } from 'astro';
import type { AstroIntegration } from 'astro';

import { StyleTransformer } from '../core';
import { createPanelScript } from './ui';
import { handleTransformStyle, handleError, parseBody } from './middlewares';

interface VibelogOptions {
  root: string;
  styleTransformer: StyleTransformer;
}
function vibelog({ root, styleTransformer }: VibelogOptions): AstroIntegration {
  return {
    name: 'vibelog-dev',
    hooks: {
      'astro:config:setup': ({ injectScript }) => {
        injectScript('page', createPanelScript());
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares
          .use(parseBody())
          .use('/_vibe/transform', handleTransformStyle({ root, styleTransformer, server }))
          .use(handleError());
      },
    },
  };
}

interface DevServerOptions {
  root: string;
  port?: number;
  styleTransformer: StyleTransformer;
}
export async function createDevServer({
  root,
  port = 5000,
  styleTransformer,
}: DevServerOptions) {
  const server = await dev({
    root,
    server: { port },
    site: `http://localhost:${String(port)}`,
    devToolbar: {
      enabled: false,
    },
    integrations: [vibelog({ root, styleTransformer })],
  });

  return server;
}
