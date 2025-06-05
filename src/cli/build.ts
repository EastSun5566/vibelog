import { logger } from '../core';
import { createProdBuilder, StateManager } from '../core';

interface BuildOptions {
  out: string;
  site: string;
}
export async function buildCommand(options: BuildOptions) {
  logger.info('Building production site...');
  logger.info(`Output: ${options.out}`);
  logger.info(`Site: ${options.site}`);

  try {
    const stateManager = new StateManager();
    const state = await stateManager.loadState();

    if (!state.lastModifiedCss && !state.contentSnapshot) {
      logger.error('No dev state found. Please run "vibelog dev" first.');
      process.exit(1);
    }

    const builder = createProdBuilder({
      outDir: options.out,
      site: options.site,
      stateManager,
    });

    await builder.build();
    logger.info(`Production build completed in ${options.out}`);

  } catch (error) {
    logger.error('Build failed:', error);
    process.exit(1);
  }
}
