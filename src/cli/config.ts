import { join } from 'node:path';
import fs from 'fs-extra';
import { logger } from '../core/logger';
import type { VibelogConfig } from './types';

const CONFIG_FILES = [
  'vibelog.config.json',
  'vibelog.config.js',
  'vibelog.config.ts',
];

function mergeConfig(defaultConfig: VibelogConfig, userConfig: Partial<VibelogConfig>): VibelogConfig {
  return {
    site: { ...defaultConfig.site, ...userConfig.site },
  };
}

export async function loadConfig(root: string): Promise<VibelogConfig> {
  const defaultConfig: VibelogConfig = {
    site: {},
  };

  for (const configFile of CONFIG_FILES) {
    const configPath = join(root, configFile);
    if (await fs.exists(configPath)) {
      try {
        logger.info(`Loading config from ${configFile}`);

        if (configFile.endsWith('.js') || configFile.endsWith('.ts')) {
          const { default: config } = await import(configPath) as { default: Partial<VibelogConfig> };
          return mergeConfig(defaultConfig, config);
        } else {
          // json config
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent) as Partial<VibelogConfig>;
          return mergeConfig(defaultConfig, config);
        }
      } catch (error) {
        logger.warn(`Failed to load config from ${configFile}:`, error);
      }
    }
  }

  logger.info('No config file found, using defaults');
  return defaultConfig;
}
