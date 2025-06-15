#!/usr/bin/env node

import { cac } from 'cac';

import { version, description } from '../../package.json';
import { devCommand, type DevOptions } from './dev';
import { buildCommand, type BuildOptions } from './build';
import {
  ContentProviderName,
  AiProviderName,
  DEFAULT_CONTENT_INFO,
  DEFAULT_AI_INFO,
  DEFAULT_DEV_PORT,
  DEFAULT_BUILD_OUT_DIR,
  DEFAULT_SITE_URL,
} from '../consts';

const cli = cac('vibelog');
cli
  .version(`v${version} - ${description}`)
  .help();

cli.option('-r, --root <dir>', 'Project root directory', { default: '.' });

// dev command
cli
  .command('dev', 'Start development server with content preview', { allowUnknownOptions: false })
  .option('-c, --content <provider>', `Content provider info (name@handle). Supported name: ${Object.values(ContentProviderName).join(', ')}`, {
    default: DEFAULT_CONTENT_INFO,
  })
  .option('--ai <provider>', `AI provider info (name@modelId). Supported name: ${Object.values(AiProviderName).join(', ')}`, {
    default: DEFAULT_AI_INFO,
  })
  .option('-p, --port <port>', 'Development server port', {
    default: DEFAULT_DEV_PORT,
  })
  .example('vibelog dev --root . --content hackmd@eastsun5566 --ai openai@gpt-4o-mini')
  .example('vibelog dev --content fs@./my-content --port 3000')
  .action(async (options: DevOptions) => {
    await devCommand(options);
  });

// build command
cli
  .command('build', 'Build production site from dev state', { allowUnknownOptions: false })
  .option('-d, --out-dir <dir>', 'Output directory', {
    default: DEFAULT_BUILD_OUT_DIR,
  })
  .option('--site-url <url>', 'Site URL for sitemap', {
    default: DEFAULT_SITE_URL,
  })
  .example('vibelog build --out-dir public --site-url https://myblog.com')
  .action(async (options: BuildOptions) => {
    await buildCommand(options);
  });

cli.parse();
