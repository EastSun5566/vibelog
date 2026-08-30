import { z } from 'zod';
import type { OperationMessage } from '../ports/operation-queue.js';
import type { TaskRequestVerifier } from '../ports/task-request-verifier.js';

const messageSchema = z.object({ version: z.literal(1), operationId: z.uuid(), traceId: z.string().min(1).max(128), createdAt: z.iso.datetime() });
export class TaskAuthenticationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskAuthenticationError'; }
}
export class CloudTasksRequestVerifier implements TaskRequestVerifier {
  constructor(private readonly expectedQueue: string) {}
  async verify(request: Request): Promise<OperationMessage> {
    if (!request.headers.get('authorization')?.startsWith('Bearer ')) throw new TaskAuthenticationError('Missing task identity');
    if (request.headers.get('x-cloudtasks-queuename') !== this.expectedQueue) throw new TaskAuthenticationError('Unexpected task queue');
    return messageSchema.parse(await request.json());
  }
}
export class LocalTaskRequestVerifier implements TaskRequestVerifier {
  async verify(request: Request): Promise<OperationMessage> { return messageSchema.parse(await request.json()); }
}
