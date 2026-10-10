import type { CredentialStore } from './credentials.js';

interface Recovery {
  action: 'request_publish_access' | 'login' | 'read_context' | 'check_secure_storage' | 'wait_retry_after' | 'retry_same_request' | 'retry_read' | 'resume_wait' | 'open_editor' | 'check_request' | 'check_service' | 'restart_login';
  operationId?: string;
}
interface ErrorMetadata { status?: number; requestId?: string; retryAfterSeconds?: number; recovery?: Recovery }

function recoveryFor(code: string, status?: number): Recovery {
  if (code === 'publish_permission_required') return { action: 'request_publish_access' };
  if (code === 'login_required' || code === 'agent_unauthorized') return { action: 'login' };
  if (code === 'secure_storage_unavailable') return { action: 'check_secure_storage' };
  if (['state_changed', 'operation_in_progress', 'blog_already_connected', 'blog_not_found', 'draft_not_ready', 'source_locked'].includes(code)) return { action: 'read_context' };
  if (code === 'deletion_in_progress') return { action: 'open_editor' };
  if (code === 'pairing_expired' || code === 'pairing_denied') return { action: 'restart_login' };
  if (status === 429) return { action: 'wait_retry_after' };
  return { action: status && status >= 500 ? 'check_service' : 'check_request' };
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  if (!/^\d+$/u.test(header) && new Date(header).toUTCString() !== header) return undefined;
  const value = /^\d+$/u.test(header) ? Number(header) : Math.max(0, Math.ceil((Date.parse(header) - Date.now()) / 1000));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export class CliError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly recovery: Recovery;
  constructor(readonly code: string, message: string, readonly details?: unknown, metadata: ErrorMetadata = {}) {
    super(message);
    this.status = metadata.status; this.requestId = metadata.requestId; this.retryAfterSeconds = metadata.retryAfterSeconds;
    this.recovery = metadata.recovery ?? recoveryFor(code, metadata.status);
  }
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
    catch { throw new CliError('network_outcome_unknown', key ? 'Request outcome is unknown. Retry with the same request key and exact input.' : 'The service could not be reached. Do not start another login automatically.', key ? { requestKey: key } : undefined, { recovery: { action: key ? 'retry_same_request' : method === 'GET' ? 'retry_read' : 'check_service' } }); }
    const requestId = response.headers.get('x-request-id');
    const metadata: ErrorMetadata = {
      status: response.status,
      requestId: requestId && /^[A-Za-z0-9_-]{1,128}$/u.test(requestId) ? requestId : undefined,
      retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
    };
    const data: unknown = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CliError('invalid_response', 'The service returned an invalid response.', key ? { requestKey: key } : undefined, { ...metadata, recovery: { action: key ? 'retry_same_request' : 'check_service' } });
    const result = data as Record<string, unknown>;
    if (!response.ok && response.status !== 422) {
      const error = result.error as { code?: unknown; message?: unknown; requestId?: unknown } | undefined;
      if (!metadata.requestId && typeof error?.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(error.requestId)) metadata.requestId = error.requestId;
      throw new CliError(typeof error?.code === 'string' ? error.code : 'request_failed', typeof error?.message === 'string' ? error.message : 'Request failed.', undefined, metadata);
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
      catch (error) {
        if (!(error instanceof CliError)) throw error;
        if (now() >= end && error.code === 'network_outcome_unknown') break;
        throw new CliError(error.code, error.message, { operationId: id }, {
          status: error.status, requestId: error.requestId, retryAfterSeconds: error.retryAfterSeconds,
          recovery: { ...error.recovery, ...(error.code === 'network_outcome_unknown' ? { action: 'resume_wait' as const } : {}), operationId: id },
        });
      }
      if (result.status === 'succeeded' || result.status === 'failed') return result;
      await sleep(Math.min(delay, Math.max(0, end - now()))); delay = Math.min(20_000, delay + 5000);
    }
    return { status: 'pending', operationId: id, message: 'Still pending. Resume with wait and the same operation ID.' };
  }
}
