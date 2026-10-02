import { describe, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/client.js';
import { run } from '../src/commands.js';
import type { CredentialStore } from '../src/credentials.js';

const store = (): CredentialStore => ({ get: vi.fn(() => Promise.resolve({ token: 'private-test-grant', expiresAt: '2099-01-01' })), set: vi.fn(() => Promise.resolve()), delete: vi.fn(() => Promise.resolve()), check: vi.fn(() => Promise.resolve()) });
describe('draft-only CLI', () => {
  it('help names the public scoped package without loading credentials', async () => {
    const write = vi.fn(); await run(['--help'], { write }); expect(write).toHaveBeenCalledWith(expect.stringContaining('@vibelog/cli'));
  });
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
    await expect(client.request('/design', 'POST', {}, 'request-key-123456')).rejects.toMatchObject({ code: 'network_outcome_unknown', details: { requestKey: 'request-key-123456' } });
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
