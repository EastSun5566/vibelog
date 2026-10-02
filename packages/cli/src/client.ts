import type { CredentialStore } from './credentials.js';

export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export class AgentClient {
  constructor(readonly origin: string, readonly store: CredentialStore, readonly fetcher: typeof fetch = fetch) {}
  async request(path: string, method = 'GET', body?: unknown, key?: string, anonymous = false, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (key) headers.set('Idempotency-Key', key);
    if (!anonymous) {
      const credentials = await this.store.get().catch(() => { throw new CliError('secure_storage_unavailable', 'OS secure storage is required; no file fallback is supported.'); });
      if (!credentials) throw new CliError('login_required', 'Run login first.');
      headers.set('Authorization', `Bearer ${credentials.token}`);
    }
    let response: Response;
    try { response = await this.fetcher(`${this.origin}/api/agent/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, timeoutMs))) }); }
    catch { throw new CliError('network_outcome_unknown', 'Request outcome is unknown. Retry with the same request key and exact input.', key ? { requestKey: key } : undefined); }
    const data: unknown = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CliError('invalid_response', 'The service returned an invalid response.');
    const result = data as Record<string, unknown>;
    if (!response.ok && response.status !== 422) {
      const error = result.error as { code?: unknown; message?: unknown } | undefined;
      throw new CliError(typeof error?.code === 'string' ? error.code : 'request_failed', typeof error?.message === 'string' ? error.message : 'Request failed.');
    }
    return result;
  }
  async wait(id: string, sleep: (ms: number) => Promise<void>, now = Date.now, timeout = 600_000) {
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new CliError('invalid_operation_id', 'Supply an operation UUID.');
    const end = now() + timeout;
    let delay = 5000;
    while (now() < end) {
      let result;
      try { result = await this.request(`/operations/${id}`, 'GET', undefined, undefined, false, end - now()); }
      catch (error) { if (now() >= end && error instanceof CliError && error.code === 'network_outcome_unknown') break; throw error; }
      if (result.status === 'succeeded' || result.status === 'failed') return result;
      await sleep(Math.min(delay, Math.max(0, end - now()))); delay = Math.min(20_000, delay + 5000);
    }
    return { status: 'pending', operationId: id, message: 'Still pending. Resume with wait and the same operation ID.' };
  }
}
