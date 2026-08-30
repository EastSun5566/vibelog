import { describe, expect, it } from 'vitest';
import { CloudTasksRequestVerifier } from '../src/adapters/cloud-tasks-request-verifier.js';
import { handleOperationTask } from '../src/adapters/cloud-tasks-transport.js';
import { RetryableOperationError, TerminalOperationError } from '../src/jobs.js';
import type { OperationExecutor } from '../src/ports/operation-queue.js';

const message = { version: 1, operationId: '11111111-1111-4111-8111-111111111111', traceId: 'trace', createdAt: '2026-08-29T00:00:00.000Z' } as const;
function request(body: unknown = message, authenticated = true): Request {
  return new Request('https://worker/tasks/operations', { method: 'POST', headers: authenticated ? { authorization: 'Bearer verified-by-cloud-run', 'x-cloudtasks-queuename': 'operations', 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const verifier = new CloudTasksRequestVerifier('operations');

describe('Cloud Tasks HTTP transport', () => {
  it('keeps an active lease retryable instead of acknowledging it as a duplicate', async () => {
    const executor: OperationExecutor = { execute: () => Promise.reject(new RetryableOperationError('Lease is active', undefined, 2100)) };
    const response = await handleOperationTask(request(), verifier, executor);
    expect(response.status).toBe(503); expect(response.headers.get('retry-after')).toBe('2100');
  });
  it('rejects missing identity and malformed provider-neutral messages', async () => {
    expect((await handleOperationTask(request(message, false), verifier, { execute: () => Promise.resolve({}) })).status).toBe(401);
    expect((await handleOperationTask(request({ operationId: 'invalid' }), verifier, { execute: () => Promise.resolve({}) })).status).toBe(400);
  });

  it('acknowledges duplicate delivery and terminal application failures', async () => {
    const duplicate: OperationExecutor = { execute: () => Promise.resolve({ duplicate: true }) };
    const terminal: OperationExecutor = { execute: () => Promise.reject(new TerminalOperationError('Sync failed')) };
    expect(await (await handleOperationTask(request(), verifier, duplicate)).json()).toEqual({ duplicate: true });
    const response = await handleOperationTask(request(), verifier, terminal);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ failed: true });
  });

  it('returns a retryable status when execution infrastructure is unavailable', async () => {
    const retryable: OperationExecutor = { execute: () => Promise.reject(new Error('database unavailable')) };
    const response = await handleOperationTask(request(), verifier, retryable);
    expect(response.status).toBe(503); expect(response.headers.get('retry-after')).toBe('5');
  });
});
