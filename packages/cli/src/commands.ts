import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { AgentClient, CliError } from './client.js';
import { secureStore, type CredentialStore } from './credentials.js';
import { login } from './login.js';

export const HELP = `VibeLog CLI 0.3.0 (@vibelog/cli) — draft access only
Usage: vibelog <command> [options]
  login                 Show a browser approval URL; store the resulting grant securely
  login --no-wait       Start or resume approval without waiting; run again after approving
  logout                Revoke the grant and remove local credentials
  status                Check authorization
  context               Read draft state, saved design and content profile
  contract              Read the IR v2 schema, rules and valid example
  posts --offset N      Read article summaries, 50 per page
  validate --file PATH  Validate {"design": ...}; use --file - for stdin
  connect|sync|identity|selection|design --file PATH --request-key UUID
                        Submit JSON; reuse key and exact input on an uncertain outcome
  wait OPERATION_UUID   Poll for up to 10 minutes; pending can be resumed
Options: --origin https://vibelog.org (or a local http origin), --help
Output is JSON. Tokens are never printed. Publishing stays in the browser.`;

interface Runtime { store?: CredentialStore; fetcher?: typeof fetch; input?: () => Promise<string>; write?: (value: unknown) => void; sleep?: (ms: number) => Promise<void>; now?: () => number }
export async function run(args: string[], runtime: Runtime = {}): Promise<number> {
  const write = runtime.write ?? ((value) => { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`); });
  if (!args.length || args.includes('--help')) { write(HELP); return 0; }
  const [command, ...rest] = args; const flags: Record<string, string> = {}; const positional: string[] = [];
  let noWait = false;
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i];
    if (item === '--no-wait') { if (command !== 'login' || noWait) throw new CliError('invalid_arguments', 'Use --no-wait once, with login only.'); noWait = true; continue; }
    if (!item.startsWith('--')) { positional.push(item); continue; }
    if (!['--origin', '--file', '--request-key', '--offset'].includes(item) || !rest[i + 1] || rest[i + 1].startsWith('--') || flags[item]) throw new CliError('invalid_arguments', 'Unknown, repeated or incomplete option. Run --help.');
    flags[item] = rest[++i];
  }
  const allowed = new Set(['login', 'logout', 'status', 'context', 'contract', 'posts', 'validate', 'connect', 'sync', 'identity', 'selection', 'design', 'wait']);
  if (!allowed.has(command)) throw new CliError('unknown_command', 'Unknown command. Run --help.');
  if (command !== 'wait' && positional.length) throw new CliError('invalid_arguments', 'Unexpected arguments. Run --help.');
  const origin = new URL(flags['--origin'] ?? 'https://vibelog.org');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', 'localtest.me', 'app.localtest.me'].includes(origin.hostname)))) throw new CliError('invalid_origin', 'Use an HTTPS origin or local test origin, without credentials or a path.');
  const store = runtime.store ?? await secureStore(origin.origin).catch(() => { throw new CliError('secure_storage_unavailable', 'OS secure storage is required; no file fallback is supported.'); });
  const client = new AgentClient(origin.origin, store, runtime.fetcher);
  const pause = runtime.sleep ?? sleep; const now = runtime.now ?? Date.now;
  if (command === 'login') return login(client, noWait, write, pause, now);
  if (command === 'logout') {
    try { await client.request('/session', 'DELETE'); }
    catch (error) { if (!(error instanceof CliError) || !['agent_unauthorized', 'login_required'].includes(error.code)) throw error; }
    await store.delete(); await store.deletePairing(); write({ status: 'revoked' }); return 0;
  }
  if (command === 'wait') { if (positional.length !== 1) throw new CliError('invalid_arguments', 'Supply one operation ID.'); const result = await client.wait(positional[0], pause, now); write(result); return result.status === 'failed' ? 1 : 0; }
  if (['status', 'context', 'contract', 'posts'].includes(command)) {
    const path = command === 'status' ? '/session' : command === 'contract' ? '/design/contract' : command === 'posts' ? `/posts?offset=${encodeURIComponent(flags['--offset'] ?? '0')}` : '/context';
    write(await client.request(path)); return 0;
  }
  const file = flags['--file']; if (!file) throw new CliError('invalid_arguments', 'Supply --file PATH or --file - for stdin.');
  const text = file === '-' ? await (runtime.input ?? readInput)() : await readFile(file, 'utf8');
  if (Buffer.byteLength(text) > 64 * 1024) throw new CliError('input_too_large', 'Input must not exceed 64 KiB.');
  let input: unknown; try { input = JSON.parse(text); } catch { throw new CliError('invalid_json', 'Input is not valid JSON.'); }
  const key = flags['--request-key'];
  if (command !== 'validate' && (!key || !/^[A-Za-z0-9_-]{16,128}$/u.test(key))) throw new CliError('invalid_request_key', 'Supply a stable --request-key of 16–128 characters.');
  const result = await client.request(command === 'validate' ? '/design/validate' : `/${command}`, 'POST', input, key);
  write(result); return result.valid === false ? 1 : 0;
}
async function readInput(): Promise<string> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of process.stdin) { const buffer = Buffer.from(chunk as Uint8Array); length += buffer.length; if (length > 64 * 1024) throw new CliError('input_too_large', 'Input must not exceed 64 KiB.'); chunks.push(buffer); }
  return Buffer.concat(chunks).toString('utf8');
}
