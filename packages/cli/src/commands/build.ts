import { resolve } from 'node:path';
import { buildFromVibelog, logger } from '@vibelog/core';

export interface BuildOptions {
  outDir: string;
  siteUrl: string;
  root: string;
}

export async function buildCommand({ outDir, root, siteUrl }: BuildOptions) {
  logger.info('Building production site...');
  logger.info(`Project root: ${root}`);
  logger.info(`Output: ${outDir}`);
  logger.info(`Site: ${siteUrl}`);

  try {
    await buildFromVibelog({
      vibelogDir: resolve(process.cwd(), root, '.vibelog'),
      outDir: resolve(process.cwd(), root, outDir),
      site: siteUrl,
    });
  } catch (error) {
    logger.error('Build failed:', error);
    process.exit(1);
  }
}
