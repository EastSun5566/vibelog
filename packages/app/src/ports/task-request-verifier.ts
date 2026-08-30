import type { OperationMessage } from './operation-queue.js';
export interface TaskRequestVerifier { verify(request: Request): Promise<OperationMessage> }
