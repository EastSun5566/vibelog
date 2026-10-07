import { describe, expect, it, vi } from 'vitest';
import { AgentClient, CliError } from '../src/client.js';
import { run } from '../src/commands.js';
import type { CredentialStore } from '../src/credentials.js';

const store = (): CredentialStore => ({ get: vi.fn(() => Promise.resolve({ token: 'private-test-grant', expiresAt: '2099-01-01' })), set: vi.fn(() => Promise.resolve()), delete: vi.fn(() => Promise.resolve()), check: vi.fn(() => Promise.resolve()) });
describe('draft-only CLI', () => {
  it('help names the public scoped package without loading credentials', async () => {
    const write = vi.fn(); await run(['--help'], { write }); expect(write).toHaveBeenCalledWith(expect.stringContaining('@vibelog/cli'));
  });
  it('reuses authorization and passes through old and new service payloads without creating work', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ permission: 'draft:read-write', expiresAt: '2099-01-01' }))
      .mockResolvedValueOnce(Response.json({ blog: null, sourceReady: false, draftReady: false }))
      .mockResolvedValueOnce(Response.json({ blog: null, nextActions: [{ action: 'connect' }] }));
    const write = vi.fn<(value: unknown) => void>();
    for (const command of ['status', 'context', 'context']) expect(await run([command], { store: store(), fetcher, write })).toBe(0);
    expect(write.mock.calls.map(([value]) => value)).toEqual([
      { permission: 'draft:read-write', expiresAt: '2099-01-01' },
      { blog: null, sourceReady: false, draftReady: false },
      { blog: null, nextActions: [{ action: 'connect' }] },
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it.each(['login_required', 'agent_unauthorized', 'secure_storage_unavailable'])(
    'reports %s without silently pairing again', async (code) => {
      const credentials = store();
      if (code === 'login_required') credentials.get = () => Promise.resolve(null);
      if (code === 'secure_storage_unavailable') credentials.get = () => Promise.reject(new Error('locked'));
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code, message: 'Authorization unavailable.' } }, { status: 401 }));
      await expect(run(['status'], { store: credentials, fetcher })).rejects.toMatchObject({ code, recovery: { action: code === 'secure_storage_unavailable' ? 'check_secure_storage' : 'login' } });
      expect(fetcher.mock.calls.every(([url]) => typeof url === 'string' && url.endsWith('/session'))).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(code === 'agent_unauthorized' ? 1 : 0);
    },
  );
  it('stores the approved token without printing it or the private device code', async () => {
    const credentials = store(); const write = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ deviceCode: 'private-device', userCode: 'AABBCCDD00', authorizationUrl: 'https://vibelog.org/agent/authorize?code=AABBCCDD00', expiresAt: '2099-01-01' }))
      .mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' }));
    expect(await run(['login'], { store: credentials, fetcher, write, sleep: () => Promise.resolve() })).toBe(0);
    expect(vi.mocked(credentials.set)).toHaveBeenCalledWith({ token: 'private-grant', expiresAt: '2099-01-01' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('private-grant'); expect(JSON.stringify(write.mock.calls)).not.toContain('private-device');
  });
  it('fails before pairing when secure storage is unavailable', async () => {
    const credentials = store(); credentials.check = () => Promise.reject(new Error('locked'));
    const fetcher = vi.fn(); await expect(run(['login'], { store: credentials, fetcher })).rejects.toMatchObject({ code: 'secure_storage_unavailable' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('submits stdin JSON with the same request key and no token in the URL or output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operationId: 'op' })); const write = vi.fn();
    await run(['design', '--file', '-', '--request-key', 'request-key-123456'], { store: store(), fetcher, write, input: () => Promise.resolve('{"stateVersion":"state","design":{}}') });
    const [url, request] = fetcher.mock.calls[0]; expect(url).toBe('https://vibelog.org/api/agent/v1/design');
    expect(new Headers(request?.headers).get('Idempotency-Key')).toBe('request-key-123456'); expect(request?.redirect).toBe('error');
    expect(JSON.stringify(write.mock.calls)).not.toContain('private-test-grant');
  });
  it('reports an uncertain outcome without inventing a new operation', async () => {
    const client = new AgentClient('https://vibelog.org', store(), vi.fn<typeof fetch>().mockRejectedValue(new Error('network')));
    await expect(client.request('/design', 'POST', {}, 'request-key-123456')).rejects.toMatchObject({ code: 'network_outcome_unknown', details: { requestKey: 'request-key-123456' }, recovery: { action: 'retry_same_request' } });
  });
  it.each([
    ['state_changed', 409, 'read_context'], ['operation_in_progress', 409, 'read_context'],
    ['agent_build_quota_exceeded', 429, 'wait_retry_after'], ['rate_limited', 429, 'wait_retry_after'],
    ['internal_error', 503, 'check_service'], ['deletion_in_progress', 409, 'open_editor'],
  ])('preserves HTTP diagnostics for %s and never retries automatically', async (code, status, action) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code, message: 'Request unavailable.', requestId: 'body-request-id', details: 'do-not-copy-body' } }, { status, headers: { 'X-Request-Id': 'header-request-id', 'Retry-After': '120' } }));
    const client = new AgentClient('https://vibelog.org', store(), fetcher);
    const error = await client.request('/context').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code, status, requestId: 'header-request-id', retryAfterSeconds: 120, recovery: { action } });
    expect(JSON.stringify(error)).not.toContain('do-not-copy-body'); expect(JSON.stringify(error)).not.toContain('private-test-grant');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses a safe body request id and ignores malformed retry headers', async () => {
    const client = new AgentClient('https://vibelog.org', store(), vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'rate_limited', message: 'Wait.', requestId: 'body-request-id' } }, { status: 429, headers: { 'Retry-After': '2099' } })));
    // Numeric values are delays, not years.
    await expect(client.request('/context')).rejects.toMatchObject({ requestId: 'body-request-id', retryAfterSeconds: 2099 });
    for (const retry of ['-1', '1.5', 'Infinity', '999999999999999999999999', 'tomorrow']) {
      const malformed = new AgentClient('https://vibelog.org', store(), vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'rate_limited', message: 'Wait.', requestId: '<script>' } }, { status: 429, headers: { 'Retry-After': retry } })));
      const error = await malformed.request('/context').catch((value: unknown) => value);
      expect(error).toMatchObject({ status: 429, recovery: { action: 'wait_retry_after' } });
      expect(error).toHaveProperty('retryAfterSeconds', undefined); expect(error).toHaveProperty('requestId', undefined);
    }
  });
  it('handles HTTP-date Retry-After without changing the server delay', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    try {
      const client = new AgentClient('https://vibelog.org', store(), vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'rate_limited', message: 'Wait.' } }, { status: 429, headers: { 'Retry-After': 'Thu, 08 Oct 2026 00:01:00 GMT' } })));
      await expect(client.request('/context')).rejects.toMatchObject({ retryAfterSeconds: 60 });
    } finally { vi.useRealTimers(); }
  });
  it('distinguishes interrupted reads and retains ids for interrupted waits and expired grants', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const client = new AgentClient('https://vibelog.org', store(), fetcher);
    await expect(client.request('/context')).rejects.toMatchObject({ code: 'network_outcome_unknown', recovery: { action: 'retry_read' } });
    const id = '12345678-1234-1234-1234-123456789abc';
    await expect(client.wait(id, () => Promise.resolve())).rejects.toMatchObject({ code: 'network_outcome_unknown', details: { operationId: id }, recovery: { action: 'resume_wait', operationId: id } });
    fetcher.mockResolvedValue(Response.json({ error: { code: 'agent_unauthorized', message: 'Grant revoked.' } }, { status: 401 }));
    await expect(client.wait(id, () => Promise.resolve())).rejects.toMatchObject({ status: 401, details: { operationId: id }, recovery: { action: 'login', operationId: id } });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retains the mutation key when the response cannot confirm its outcome', async () => {
    const client = new AgentClient('https://vibelog.org', store(), vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 502 })));
    await expect(client.request('/design', 'POST', {}, 'request-key-123456')).rejects.toMatchObject({ code: 'invalid_response', status: 502, details: { requestKey: 'request-key-123456' }, recovery: { action: 'retry_same_request' } });
  });
  it('stops polling within the deadline, preserves the operation id and supports resumption', async () => {
    let time = 0; const delays: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({ status: 'running' })));
    const client = new AgentClient('https://vibelog.org', store(), fetcher); const id = '12345678-1234-1234-1234-123456789abc';
    expect(await client.wait(id, (ms) => { delays.push(ms); time += ms; return Promise.resolve(); }, () => time, 600_000)).toMatchObject({ status: 'pending', operationId: id });
    expect(time).toBe(600_000); expect(delays.slice(0, 4)).toEqual([5000, 10000, 15000, 20000]); expect(Math.max(...delays)).toBe(20000);
    fetcher.mockResolvedValue(Response.json({ status: 'succeeded' })); expect(await client.wait(id, () => Promise.resolve(), () => time)).toMatchObject({ status: 'succeeded' });
  });
  it('rejects publishing and credential arguments', async () => {
    await expect(run(['publish'], { store: store() })).rejects.toMatchObject({ code: 'unknown_command' });
    await expect(run(['status', '--token', 'secret'], { store: store() })).rejects.toMatchObject({ code: 'invalid_arguments' });
  });
  it('returns a nonzero status for invalid designs', async () => {
    const write = vi.fn(); expect(await run(['validate', '--file', '-'], { store: store(), input: () => Promise.resolve('{"design":{}}'), write, fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ valid: false, errors: [{ path: 'version', message: 'Required' }] }, { status: 422 })) })).toBe(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
  });
});
