import { TerminalOperationError } from '../jobs.js';
import type { OperationExecutor } from '../ports/operation-queue.js';
import type { TaskRequestVerifier } from '../ports/task-request-verifier.js';
import { TaskAuthenticationError } from './cloud-tasks-request-verifier.js';

export async function handleOperationTask(request: Request, verifier: TaskRequestVerifier, executor: OperationExecutor): Promise<Response> {
  let operationId: string;
  try { operationId = (await verifier.verify(request)).operationId; }
  catch (error) {
    const status = error instanceof TaskAuthenticationError ? 401 : 400;
    return Response.json({ error: status === 401 ? 'Invalid task identity' : 'Invalid task payload' }, { status });
  }
  try { return Response.json(await executor.execute(operationId)); }
  catch (error) {
    if (error instanceof TerminalOperationError) return Response.json({ failed: true, message: error.message });
    return Response.json({ error: 'Temporary task failure' }, { status: 503, headers: { 'Retry-After': '5' } });
  }
}
