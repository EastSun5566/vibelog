import { describe, expect, it } from 'vitest';
import { CloudTasksRequestVerifier } from '../src/adapters/cloud-tasks-request-verifier.js';
const body = { version: 1, operationId: '11111111-1111-4111-8111-111111111111', traceId: 'trace', createdAt: '2026-08-29T00:00:00.000Z' };
describe('CloudTasksRequestVerifier', () => {
  const verifier = new CloudTasksRequestVerifier('operations');
  it('rejects requests without the Cloud Run identity boundary', async () => { await expect(verifier.verify(new Request('https://worker/tasks', { method: 'POST', body: JSON.stringify(body) }))).rejects.toThrow('Missing task identity'); });
  it('rejects an unexpected queue', async () => { await expect(verifier.verify(new Request('https://worker/tasks', { method: 'POST', headers: { authorization: 'Bearer token', 'x-cloudtasks-queuename': 'other' }, body: JSON.stringify(body) }))).rejects.toThrow('Unexpected task queue'); });
  it('normalizes a valid transport request', async () => { await expect(verifier.verify(new Request('https://worker/tasks', { method: 'POST', headers: { authorization: 'Bearer token', 'x-cloudtasks-queuename': 'operations' }, body: JSON.stringify(body) }))).resolves.toEqual(body); });
});
