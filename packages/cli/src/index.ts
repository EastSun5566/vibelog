#!/usr/bin/env node

import { cac } from 'cac';
import { createRequire } from 'node:module';
import {
  ContentSourceName,
} from '@vibelog/core';

import { devCommand, type DevOptions } from './commands/dev.js';
import { buildCommand, type BuildOptions } from './commands/build.js';

const DEFAULT_CONTENT_INFO = 'fs@./content';
const DEFAULT_AI_INFO = 'openai@gpt-4o-mini';
const DEFAULT_DEV_PORT = 5566;
const DEFAULT_BUILD_OUT_DIR = 'dist';
const DEFAULT_SITE_URL = 'https://example.com';
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const cli = cac('vibelog');
cli
  .version(`v${version}`)
  .help();

cli.option('-r, --root <dir>', 'Project root directory', { default: '.' });

// dev command
cli
  .command('dev', 'Start development server with content preview', { allowUnknownOptions: false })
  .option('-c, --content <source>', `Content source info (name@handle). Supported name: ${Object.values(ContentSourceName).join(', ')}`, {
    default: DEFAULT_CONTENT_INFO,
  })
  .option('--ai <provider>', 'AI provider info (name@modelId). Provider and model IDs come from the pi-ai catalog; Ollama model IDs are unrestricted.', {
    default: DEFAULT_AI_INFO,
  })
  .option('-p, --port <port>', 'Development server port', {
    default: DEFAULT_DEV_PORT,
  })
  .option('--no-install', 'Use the packaged template runtime without running npm install')
  .example('vibelog dev --root . --content hackmd@eastsun5566 --ai openai@gpt-4o-mini')
  .example('vibelog dev --content fs@./my-content --port 5566')
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
  .example('vibelog build --root . --out-dir dist')
  .action(async (options: BuildOptions) => {
    await buildCommand(options);
  });

cli.parse();
