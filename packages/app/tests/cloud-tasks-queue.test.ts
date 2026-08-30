import { beforeEach, describe, expect, it, vi } from 'vitest';
const createTask = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
vi.mock('@google-cloud/tasks', () => ({ CloudTasksClient: class {
  queuePath(...parts: string[]) { return parts.join('/'); }
  taskPath(...parts: string[]) { return parts.join('/'); }
  createTask = createTask;
} }));
import { CloudTasksOperationQueue } from '../src/adapters/cloud-tasks-queue.js';

const queue = new CloudTasksOperationQueue({ project: 'project', location: 'region', queue: 'queue', workerUrl: 'https://worker.run.app', serviceAccountEmail: 'tasks@example.com' });
const message = { version: 1, operationId: 'operation', traceId: 'delivery-1', createdAt: new Date().toISOString() } as const;
beforeEach(() => createTask.mockClear());
describe('Cloud Tasks delivery identity', () => {
  it('deduplicates one delivery but gives recovery a new task name', async () => {
    await queue.enqueue(message); await queue.enqueue(message); await queue.enqueue({ ...message, traceId: 'delivery-2' });
    const calls = createTask.mock.calls as unknown as [{ task: { name: string } }][];
    expect(calls[0]?.[0].task.name).toBe(calls[1]?.[0].task.name);
    expect(calls[2]?.[0].task.name).not.toBe(calls[0]?.[0].task.name);
  });
  it('accepts an already-created delivery but propagates real delivery failures', async () => {
    createTask.mockRejectedValueOnce({ code: 6 }); await expect(queue.enqueue(message)).resolves.toBeUndefined();
    createTask.mockRejectedValueOnce(new Error('unavailable')); await expect(queue.enqueue(message)).rejects.toThrow('unavailable');
  });
});
