import { logger } from '../core';
import { createDevServer } from '../dev';
import { createContentProvider, createAiProvider } from './providers';
import { createStyleTransformer, StateManager, createDevBuilder } from '../core';

interface DevOptions {
  content: string;
  ai: string;
  port: string;
}
export async function devCommand({ content, ai, port }: DevOptions) {
  logger.info('Starting vibelog dev server...');
  logger.info(`Content: ${content}`);
  logger.info(`AI: ${ai}`);

  try {
    const contentProvider = createContentProvider(content);
    const aiProvider = createAiProvider(ai);
    const styleTransformer = createStyleTransformer({ aiProvider });
    const stateManager = new StateManager();

    const devBuilder = createDevBuilder({
      tempDir: '.temp',
      contentProvider,
      styleTransformer,
      stateManager,
    });

    await devBuilder.prepare();
    await devBuilder.fetchContent();

    const server = await createDevServer({
      root: '.temp',
      port: parseInt(port),
      styleTransformer,
      stateManager,
    });
    logger.info(`Dev server running at http://localhost:${port}`);
    logger.info('Use the toolbar to modify styles with AI prompts');
    logger.info('Press Ctrl+C to stop');

    const cleanup = () => {
      logger.info('Shutting down...');
      server.stop()
        .then(() => {
          logger.info('Dev server stopped');
          return devBuilder.cleanup();
        })
        .then(() => {
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
