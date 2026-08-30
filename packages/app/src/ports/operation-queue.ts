export interface OperationMessage { version: 1; operationId: string; traceId: string; createdAt: string }
export interface OperationQueue { enqueue(message: OperationMessage): Promise<void> }
export interface OperationDispatcher { dispatch(limit?: number): Promise<number> }
export type OperationResult = Record<string, unknown>;
export interface OperationExecutor { execute(operationId: string): Promise<OperationResult> }
