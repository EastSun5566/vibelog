import { logger } from '../core';
import { createDevServer } from '../dev';
import { createContentProvider, createAiProvider } from './providers';
import { createStyleTransformer, createDevBuilder } from '../core';

export interface DevOptions {
  content: string;
  ai: string;
  port: string;
  root: string;
}
export async function devCommand({ content, ai, port, root }: DevOptions) {
  logger.info('Starting vibelog dev server...');
  logger.info(`Project root: ${root}`);

  try {
    const contentProvider = createContentProvider(content);
    const aiProvider = createAiProvider(ai);
    const styleTransformer = createStyleTransformer({ aiProvider });

    const devBuilder = createDevBuilder({
      root,
      contentProvider,
    });

    await devBuilder.prepare();
    await devBuilder.fetchContent();

    const server = await createDevServer({
      root: devBuilder.vibelogDir,
      port: parseInt(port),
      styleTransformer,
    });

    logger.info('Use the vibelog panel to modify styles with AI prompts');
    logger.info('Press Ctrl+C to stop');

    const cleanup = () => {
      logger.info('Shutting down...');
      server.stop()
        .then(() => {
          logger.info('Dev server stopped');
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error('Cleanup failed:', error);
          process.exit(1);
        });
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    logger.error('Failed to start dev server:', error);
    process.exit(1);
  }
}
