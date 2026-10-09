import { describe, expect, it, vi } from 'vitest';
import { AgentClient, CliError } from '../src/client.js';
import { run } from '../src/commands.js';
import { parsePairing, type Credentials, type CredentialStore, type PendingPairing } from '../src/credentials.js';

const store = (authorized = true): CredentialStore => {
  let credentials: Credentials | null = authorized ? { token: 'private-test-grant', expiresAt: '2099-01-01' } : null;
  let pairing: PendingPairing | null = null;
  return {
    get: vi.fn(() => Promise.resolve(credentials)), set: vi.fn((value: Credentials) => { credentials = value; return Promise.resolve(); }),
    delete: vi.fn(() => { credentials = null; return Promise.resolve(); }), check: vi.fn(() => Promise.resolve()),
    getPairing: vi.fn(() => Promise.resolve(pairing ? structuredClone(pairing) : null)),
    setPairing: vi.fn((value: PendingPairing) => { pairing = structuredClone(value); return Promise.resolve(); }),
    deletePairing: vi.fn(() => { pairing = null; return Promise.resolve(); }),
  };
};
const pairingResponse = { deviceCode: 'd'.repeat(43), userCode: 'AABBCCDD00', authorizationUrl: 'https://vibelog.org/agent/authorize?code=AABBCCDD00', expiresAt: '2099-01-01' };
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
    const credentials = store(false); const write = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pairingResponse))
      .mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' }));
    expect(await run(['login'], { store: credentials, fetcher, write, sleep: () => Promise.resolve() })).toBe(0);
    expect(vi.mocked(credentials.set)).toHaveBeenCalledWith({ token: 'private-grant', expiresAt: '2099-01-01' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('private-grant'); expect(JSON.stringify(write.mock.calls)).not.toContain(pairingResponse.deviceCode);
  });
  it('waits after creation and pending responses even when the transport has latency', async () => {
    const credentials = store(false); const polls: number[] = []; const delays: number[] = []; let time = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((url) => {
      time += 200;
      if (url === 'https://vibelog.org/api/agent/v1/pairings') return Promise.resolve(Response.json(pairingResponse));
      polls.push(time);
      return Promise.resolve(Response.json(polls.length === 1 ? { status: 'pending' } : { status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' }));
    });
    expect(await run(['login'], { store: credentials, fetcher, write: vi.fn(), now: () => time, sleep: (ms) => { time += ms; delays.push(ms); return Promise.resolve(); } })).toBe(0);
    expect(delays).toEqual([5000, 5000]); expect(polls).toEqual([5400, 10_600]);
  });
  it('revokes an approved grant when its expiry is invalid without saving or printing it', async () => {
    const credentials = store(false); const write = vi.fn(); await credentials.setPairing(pairingResponse);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: 'not-a-date' }))
      .mockRejectedValueOnce(new Error('revoke interrupted'));
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher, write })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://vibelog.org/api/agent/v1/session');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE', redirect: 'error', headers: { Authorization: 'Bearer private-grant' } });
    expect(credentials.set).not.toHaveBeenCalled(); expect(await credentials.getPairing()).not.toBeNull(); expect(write).not.toHaveBeenCalled();
  });
  it('starts immediately, resumes the same pairing across invocations and only clears it after saving the grant', async () => {
    const credentials = store(false); const write = vi.fn(); const pause = vi.fn(); let time = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pairingResponse))
      .mockResolvedValueOnce(Response.json({ status: 'pending' }))
      .mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' }));
    const runtime = { store: credentials, fetcher, write, sleep: pause, now: () => time };
    expect(await run(['login', '--no-wait'], runtime)).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(pause).not.toHaveBeenCalled();
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'approval_required', expiresAt: '1970-01-01T00:10:00.000Z', retryAfterSeconds: 5 }));
    expect(await run(['login', '--no-wait'], runtime)).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    time = 5000;
    expect(await run(['login', '--no-wait'], runtime)).toBe(0);
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'approval_required', retryAfterSeconds: 5 }));
    // A rapid rerun respects the persisted polling interval without another request.
    expect(await run(['login', '--no-wait'], runtime)).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2);
    time = 10_000;
    expect(await run(['login', '--no-wait'], runtime)).toBe(0);
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'authorized' }));
    expect(await credentials.getPairing()).toBeNull(); expect(pause).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([url]) => url === 'https://vibelog.org/api/agent/v1/pairings')).toHaveLength(1);
    expect(fetcher.mock.calls.slice(1).map(([, init]) => init?.body)).toEqual([JSON.stringify({ deviceCode: pairingResponse.deviceCode }), JSON.stringify({ deviceCode: pairingResponse.deviceCode })]);
    expect(vi.mocked(credentials.set).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(credentials.deletePairing).mock.invocationCallOrder[0]);
    expect(JSON.stringify(write.mock.calls)).not.toContain(pairingResponse.deviceCode); expect(JSON.stringify(write.mock.calls)).not.toContain('private-grant');
  });
  it('continues the blocking login from a saved pairing with its original deadline and Retry-After', async () => {
    const credentials = store(false); let time = 0; const delays: number[] = [];
    await credentials.setPairing({ ...pairingResponse, expiresAt: new Date(60_000).toISOString() });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'slow_down', message: 'Wait.' } }, { status: 429, headers: { 'Retry-After': '12' } }))
      .mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' }));
    expect(await run(['login'], { store: credentials, fetcher, write: vi.fn(), now: () => time, sleep: (ms) => { time += ms; delays.push(ms); return Promise.resolve(); } })).toBe(0);
    expect(delays).toEqual([12_000]); expect(fetcher.mock.calls.every(([url]) => typeof url === 'string' && url.endsWith('/pairings/token'))).toBe(true);
  });
  it('bounds blocking Retry-After by the original expiry and clears the expired request', async () => {
    const credentials = store(false); let time = 0; const delays: number[] = [];
    await credentials.setPairing({ ...pairingResponse, expiresAt: new Date(8000).toISOString() });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'slow_down', message: 'Wait.' } }, { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(run(['login'], { store: credentials, fetcher, write: vi.fn(), now: () => time, sleep: (ms) => { time += ms; delays.push(ms); return Promise.resolve(); } })).rejects.toMatchObject({ code: 'pairing_expired' });
    expect(delays).toEqual([8000]); expect(fetcher).toHaveBeenCalledTimes(1); expect(await credentials.getPairing()).toBeNull();
  });
  it('keeps a nonblocking pairing and its retry delay after 429 or network interruption', async () => {
    const credentials = store(false); let time = 0;
    await credentials.setPairing({ ...pairingResponse, expiresAt: new Date(60_000).toISOString() });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: 'rate_limited', message: 'Wait.' } }, { status: 429, headers: { 'Retry-After': '20' } }));
    const runtime = { store: credentials, fetcher, write: vi.fn(), now: () => time, sleep: vi.fn() };
    await expect(run(['login', '--no-wait'], runtime)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 20 });
    expect(await credentials.getPairing()).toMatchObject({ nextPollAt: 20_000 });
    expect(await run(['login', '--no-wait'], runtime)).toBe(0); expect(fetcher).toHaveBeenCalledTimes(1);
    time = 20_000; fetcher.mockRejectedValueOnce(new Error('offline'));
    await expect(run(['login', '--no-wait'], runtime)).rejects.toMatchObject({ code: 'network_outcome_unknown' });
    expect(await credentials.getPairing()).toMatchObject({ deviceCode: pairingResponse.deviceCode });
  });
  it.each(['pairing_denied', 'pairing_expired'])('clears %s without silently replacing it', async (code) => {
    const credentials = store(false); await credentials.setPairing(pairingResponse);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code, message: 'Unavailable.' } }, { status: code === 'pairing_expired' ? 410 : 403 }));
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher, write: vi.fn() })).rejects.toMatchObject({ code, recovery: { action: 'restart_login' } });
    expect(await credentials.getPairing()).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears local expiry before networking and preserves a pairing when grant storage fails', async () => {
    const credentials = store(false); await credentials.setPairing({ ...pairingResponse, expiresAt: '2000-01-01' });
    const fetcher = vi.fn<typeof fetch>();
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher })).rejects.toMatchObject({ code: 'pairing_expired' }); expect(fetcher).not.toHaveBeenCalled();
    await credentials.setPairing(pairingResponse); credentials.set = () => Promise.reject(new Error('locked'));
    fetcher.mockResolvedValueOnce(Response.json({ status: 'approved', token: 'private-grant', expiresAt: '2099-01-01' })).mockResolvedValueOnce(Response.json({ status: 'revoked' }));
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher })).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
    expect(await credentials.getPairing()).not.toBeNull(); expect(fetcher.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });
  it('keeps pending storage on failures and does not create a request before it is readable', async () => {
    const credentials = store(false); credentials.getPairing = () => Promise.reject(new Error('locked'));
    const fetcher = vi.fn<typeof fetch>();
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher })).rejects.toMatchObject({ code: 'secure_storage_unavailable' }); expect(fetcher).not.toHaveBeenCalled();
    credentials.getPairing = () => Promise.resolve(null); credentials.setPairing = () => Promise.reject(new Error('locked'));
    fetcher.mockResolvedValueOnce(Response.json(pairingResponse));
    await expect(run(['login', '--no-wait'], { store: credentials, fetcher })).rejects.toMatchObject({ code: 'secure_storage_unavailable' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reuses an authorized grant and cleans stale pairing state without redeeming twice', async () => {
    const credentials = store(); await credentials.setPairing(pairingResponse);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ permission: 'draft:read-write', expiresAt: '2099-01-01' })); const write = vi.fn();
    expect(await run(['login', '--no-wait'], { store: credentials, fetcher, write })).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ status: 'authorized' })); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://vibelog.org/api/agent/v1/session'); expect(await credentials.getPairing()).toBeNull();
  });
  it('logout revokes a saved grant and removes both local entries', async () => {
    const credentials = store(); await credentials.setPairing(pairingResponse);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'revoked' }));
    expect(await run(['logout'], { store: credentials, fetcher, write: vi.fn() })).toBe(0);
    expect(await credentials.get()).toBeNull(); expect(await credentials.getPairing()).toBeNull();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
  it('logout removes a pending login without requiring a grant or network access', async () => {
    const credentials = store(false); await credentials.setPairing(pairingResponse); const fetcher = vi.fn<typeof fetch>();
    expect(await run(['logout'], { store: credentials, fetcher, write: vi.fn() })).toBe(0);
    expect(await credentials.getPairing()).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects untrusted pairing responses and use of the new flag outside login', async () => {
    for (const value of [{ ...pairingResponse, authorizationUrl: 'https://evil.test/agent/authorize?code=AABBCCDD00' }, { ...pairingResponse, expiresAt: 'not-a-date' }, { ...pairingResponse, deviceCode: 'short' }]) {
      expect(() => parsePairing(value, 'https://vibelog.org')).toThrow();
      await expect(run(['login', '--no-wait'], { store: store(false), fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(value)) })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    await expect(run(['status', '--no-wait'], { store: store() })).rejects.toMatchObject({ code: 'invalid_arguments' });
    await expect(run(['login', '--no-wait', '--no-wait'], { store: store() })).rejects.toMatchObject({ code: 'invalid_arguments' });
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
