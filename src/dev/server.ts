import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dev } from 'astro';
import fs from 'fs-extra';
import type { AstroIntegration } from 'astro';

import { StyleTransformer } from '../core/transformer';

interface VibeOptions {
  root: string;
  styleTransformer: StyleTransformer;
}

function vibe({ root, styleTransformer }: VibeOptions): AstroIntegration {
  return {
    name: 'vibe-dev',
    hooks: {
      'astro:config:setup': ({ injectScript }) => {
        injectScript('page', `
          import { VibeUI } from ${JSON.stringify(fileURLToPath(new URL('./toolbar.ts', import.meta.url)))};
          customElements.define('vibe-toolbar', VibeUI);
          document.body.appendChild(document.createElement('vibe-toolbar'));
        `);
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/_vibe/transform' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });

            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            req.on('end', async () => {
              try {
                const { prompt } = JSON.parse(body) as { prompt: string };

                const cssPath = join(root, 'src/styles/global.css');
                const originalCss = await fs.readFile(cssPath, 'utf-8');

                const transformedCss = await styleTransformer.transform({ originalCss, stylePrompt: prompt });
                await fs.writeFile(cssPath, transformedCss);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));

                server.ws.send({ type: 'full-reload' });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: errorMessage }));
              }
            });

            return;
          }

          next();
        });
      },
    },
  };
}

interface DevServerOptions extends VibeOptions {
  port?: number;
}
export async function createDevServer({
  root: _root,
  port = 5000,
  styleTransformer,
}: DevServerOptions) {
  const root = resolve(process.cwd(), _root);

  const server = await dev({
    root,
    server: { port },
    site: `http://localhost:${port.toString()}`,
    devToolbar: {
      enabled: false,
    },
    integrations: [vibe({ root, styleTransformer })],
  });

  return server;
}
