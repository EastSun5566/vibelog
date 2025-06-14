import { resolve } from 'node:path';

import { logger } from '../core';
import { buildFromVibelog } from '../core';

export interface BuildOptions {
  out: string;
  site: string;
  root: string;
}
export async function buildCommand({ out, root, site }: BuildOptions) {
  logger.info('Building production site...');
  logger.info(`Project root: ${root}`);
  logger.info(`Output: ${out}`);
  logger.info(`Site: ${site}`);

  try {
    const vibelogDir = resolve(process.cwd(), root, '.vibelog');
    const outDir = resolve(process.cwd(), root, out);

    await buildFromVibelog({
      vibelogDir,
      outDir,
      site,
    });

    logger.info(`Production build completed in ${out}`);

  } catch (error) {
    logger.error('Build failed:', error);
    process.exit(1);
  }
}
