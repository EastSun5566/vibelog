import { join } from 'node:path';
import { dev } from 'astro';
import fs from 'fs-extra';
import type { AstroIntegration } from 'astro';

import { StyleTransformer } from '../core';
import { createPanelScript } from './toolbar';
import { handleError, parseBody } from './utils';

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
          .use('/_vibe/transform', (req, res, next) => {
            if (req.method !== 'POST') {
              return res.writeHead(405).end();
            }

            const { prompt } = req.body as { prompt: string };
            if (!prompt) {
              return res.writeHead(400).end();
            }

            (async () => {
              const cssPath = join(root, 'src/styles/global.css');
              const originalCss = await fs.readFile(cssPath, 'utf-8');

              const transformedCss = await styleTransformer.transform({
                originalCss,
                stylePrompt: prompt,
              });

              await fs.writeFile(cssPath, transformedCss);
              server.ws.send({ type: 'full-reload' });

              res
                .writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ success: true }));
            })().catch(next);
          })
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
