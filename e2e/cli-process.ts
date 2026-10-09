import { CliError } from '../packages/cli/dist/client.js';
import { run } from '../packages/cli/dist/commands.js';
import process from 'node:process';
import type { Credentials, CredentialStore, PendingPairing } from '../packages/cli/src/credentials.js';

export interface CliProcessState { credentials: Credentials | null; pairing: PendingPairing | null }
export interface CliProcessResult { state: CliProcessState; output: unknown[]; exitCode: number }

// Tests inject an in-memory keyring over IPC; secrets never go to stdout or fixture files.
async function execute({ args, state }: { args: string[]; state: CliProcessState }) {
  const output: unknown[] = [];
  let exitCode = 1;
  try {
    const store: CredentialStore = {
      check: () => Promise.resolve(), get: () => Promise.resolve(state.credentials),
      set: (credentials) => { state.credentials = credentials; return Promise.resolve(); },
      delete: () => { state.credentials = null; return Promise.resolve(); },
      getPairing: () => Promise.resolve(state.pairing),
      setPairing: (pairing) => { state.pairing = pairing; return Promise.resolve(); },
      deletePairing: () => { state.pairing = null; return Promise.resolve(); },
    };
    exitCode = await run(args, { store, write: (value) => { output.push(value); } });
  } catch (error) { output.push({ error: { code: error instanceof CliError ? error.code : 'cli_error' } }); }
  process.send?.({ state, output, exitCode } satisfies CliProcessResult, () => { process.disconnect(); });
}
process.once('message', (message: { args: string[]; state: CliProcessState }) => { void execute(message); });
