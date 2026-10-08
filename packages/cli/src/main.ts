#!/usr/bin/env node
import { CliError } from './client.js';
import { run } from './commands.js';

try { process.exitCode = await run(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof CliError ? {
    code: error.code, message: error.message, details: error.details,
    status: error.status, requestId: error.requestId, retryAfterSeconds: error.retryAfterSeconds, recovery: error.recovery,
  } : { code: 'cli_error', message: 'Command failed. Check your input and OS credential store.' } })}\n`);
  process.exitCode = 1;
}
