import { describe, expect, it, vi } from 'vitest';
import type { OperationRecord, OutboxRecord } from '../src/database.js';
import { DurableOutboxWorker } from '../src/jobs.js';
import type { OperationExecutor } from '../src/ports/operation-queue.js';

const event: OutboxRecord = {
  id: 'outbox-1', operationId: '11111111-1111-4111-8111-111111111111',
  message: { version: 1, operationId: '11111111-1111-4111-8111-111111111111', traceId: 'trace', createdAt: '2026-08-30T00:00:00.000Z' },
};
function operation(status: OperationRecord['status']): OperationRecord {
  return {
    id: event.operationId, userId: 'user', blogId: 'blog', type: 'sync', status, payload: {}, result: null,
    errorMessage: null, attempts: 1, lockedAt: null, leaseExpiresAt: null,
    createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
  };
}
function repository(status: OperationRecord['status']) {
  return {
    getOperation: vi.fn(() => Promise.resolve(operation(status))),
    listPendingOutbox: vi.fn(() => Promise.resolve([event])),
    markOutboxDispatched: vi.fn(() => Promise.resolve()),
    noteOutboxAttempt: vi.fn(() => Promise.resolve()),
  };
}

describe('durable PostgreSQL outbox worker', () => {
  it('acknowledges an outbox event only after its operation is terminal', async () => {
    const database = repository('succeeded');
    const executor: OperationExecutor = { execute: vi.fn(() => Promise.resolve({ message: 'done' })) };
    expect(await new DurableOutboxWorker(database, executor).dispatch()).toBe(1);
    expect(database.markOutboxDispatched).toHaveBeenCalledWith(event.id, event.message.traceId);
  });

  it('leaves an event pending while another worker owns the operation lease', async () => {
    const database = repository('running');
    const executor: OperationExecutor = { execute: vi.fn(() => Promise.resolve({ duplicate: true })) };
    expect(await new DurableOutboxWorker(database, executor).dispatch()).toBe(0);
    expect(database.markOutboxDispatched).not.toHaveBeenCalled();
  });

  it('records a delivery attempt and retries infrastructure failures', async () => {
    const database = repository('queued');
    const executor: OperationExecutor = { execute: vi.fn(() => Promise.reject(new Error('database unavailable'))) };
    await expect(new DurableOutboxWorker(database, executor).dispatch()).rejects.toThrow('database unavailable');
    expect(database.noteOutboxAttempt).toHaveBeenCalledWith(event.id);
    expect(database.markOutboxDispatched).not.toHaveBeenCalled();
  });
});
