#!/usr/bin/env node

import minimist from 'minimist';

import { version } from '../../package.json';
import { devCommand } from './dev';
import { buildCommand } from './build';

const argv = minimist(process.argv.slice(2), {
  string: ['content', 'ai', 'port', 'out', 'site'],
  boolean: ['help', 'version'],
  alias: {
    c: 'content',
    h: 'help',
    v: 'version',
    p: 'port',
    o: 'out',
  },
  default: {
    content: 'fs@./content',
    ai: 'ollama@codegemma:2b',
    port: '5000',
    out: 'dist',
    site: 'https://example.com',
  },
});

const command = argv._[0];

function showHelp() {
  console.log(`
vibelog v${version} - Bring your own content with some vibes

Usage:
  vibelog <command> [options]

Commands:
  dev       Start development server with content preview
  build     Build production site from dev state

Dev Options:
  -c, --content <provider>      Content provider (default: fs@./content)
                           Examples: hackmd@username, fs@./content
  --ai <provider>          AI provider (default: ollama@codegemma:2b)
                           Examples: ollama@model, openai@model
  -p, --port <port>        Development server port (default: 5000)

Build Options:
  -o, --out <dir>          Output directory (default: dist)
  --site <url>             Site URL for sitemap (default: https://example.com)

Global Options:
  -h, --help               Show help
  -v, --version            Show version

Examples:
  vibelog dev --content hackmd@eastsun5566 --ai ollama@codegemma:2b
  vibelog dev --content fs@./my-content --port 3000
  vibelog build --out public --site https://myblog.com
`);
}

function showVersion() {
  console.log(`vibelog v${version}`);
}

async function main() {
  if (argv.version) {
    showVersion();
    return;
  }
  if (argv.help || !command) {
    showHelp();
    return;
  }

  try {
    switch (command) {
    case 'dev':
      await devCommand({
        content: argv.content as string,
        ai: argv.ai as string,
        port: argv.port as string,
      });
      break;

    case 'build':
      await buildCommand({
        out: argv.out as string,
        site: argv.site as string,
      });
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Run "vibelog --help" for usage information.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch(console.error);
