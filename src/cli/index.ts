#!/usr/bin/env node

import { cac } from 'cac';

import { version, description } from '../../package.json';
import { devCommand, type DevOptions } from './dev';
import { buildCommand, type BuildOptions } from './build';
import { ContentProviderName, AiProviderName } from '../consts';

const cli = cac('vibelog');
cli
  .version(`v${version} - ${description}`)
  .help();

cli.option('-r, --root <dir>', 'Project root directory', { default: '.' });

// dev command
cli
  .command('dev', 'Start development server with content preview', { allowUnknownOptions: false })
  .option('-c, --content <provider>', `Content provider info (name@handle). Supported name: ${Object.values(ContentProviderName).join(', ')}`, {
    default: 'fs@./content',
  })
  .option('--ai <provider>', `AI provider info (name@modelId). Supported name: ${Object.values(AiProviderName).join(', ')}`, {
    default: 'ollama@qwen2.5-coder:3b',
  })
  .option('-p, --port <port>', 'Development server port', {
    default: '5566',
  })
  .example('vibelog dev --root . --content hackmd@eastsun5566 --ai openai@gpt-4o-mini')
  .example('vibelog dev --content fs@./my-content --port 3000')
  .action(async (options: DevOptions) => {
    await devCommand(options);
  });

// build command
cli
  .command('build', 'Build production site from dev state', { allowUnknownOptions: false })
  .option('-o, --out <dir>', 'Output directory', {
    default: 'dist',
  })
  .option('--site <url>', 'Site URL for sitemap', {
    default: 'https://example.com',
  })
  .example('vibelog build --out public --site https://myblog.com')
  .action(async (options: BuildOptions) => {
    await buildCommand(options);
  });

cli.parse();
