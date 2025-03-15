import {
  logger,
  createBuilder,
  createStyleTransformer,
} from './core';
import { createDevServer } from './dev';
import {
  // FsProvider,
  HackMdProvider,
} from './adapters/content';
import { OllamaProvider } from './adapters/ai';

async function main() {
  // const contentProvider = new FsProvider('./.content');
  const contentProvider = new HackMdProvider('stanley2058');
  const aiProvider = new OllamaProvider('gemma3:1b');
  const styleTransformer = createStyleTransformer({ aiProvider });
  const builder = createBuilder({
    tempDir: '.temp',
    outDir: 'dist',
    contentProvider,
    styleTransformer,
  });

  // try {
  //   await builder.build({
  //     stylePrompt: 'Create a modern theme with dark blue accent colors and subtle green undertones',
  //     skipStyleTransform: false,
  //   });
  // } finally {
  //   await builder.cleanup();
  // }

  try {
    await builder.prepare();
    await builder.fetchContent();

    const server = await createDevServer({
      root: '.temp',
      styleTransformer,
    });

    const cleanup = () => {
      server.stop()
        .then(() => {
          logger.info('Dev server stopped');
          return builder.cleanup();
        })
        .then(() => {
          process.exit(0);
        })
        .catch(() => process.exit(1));
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (error) {
    logger.error('Failed to start dev server:', error);
    process.exit(1);
  }
}

main().catch(() => void 0);
