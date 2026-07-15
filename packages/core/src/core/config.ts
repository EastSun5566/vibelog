import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'fs-extra';
import { z } from 'zod';
import { logger } from './logger.js';
import type { VibelogConfig } from '../types.js';

const CONFIG_FILES = [
  'vibelog.config.json',
  'vibelog.config.mjs',
  'vibelog.config.js',
];

const configSchema = z.object({
  site: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  }).default({}),
}).strict();

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
      logger.info(`Loading config from ${configFile}`);
      try {
        const rawConfig = configFile.endsWith('.js') || configFile.endsWith('.mjs')
          ? (await import(`${pathToFileURL(configPath).href}?t=${Date.now().toString()}`) as { default: unknown }).default
          : JSON.parse(await fs.readFile(configPath, 'utf-8')) as unknown;
        return mergeConfig(defaultConfig, configSchema.parse(rawConfig));
      } catch (error) {
        throw new Error(`Invalid VibeLog config in ${configFile}`, { cause: error });
      }
    }
  }

  logger.info('No config file found, using defaults');
  return defaultConfig;
}
