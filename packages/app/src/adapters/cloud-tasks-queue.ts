import { CloudTasksClient } from '@google-cloud/tasks';
import { createHash } from 'node:crypto';
import type { OperationMessage, OperationQueue } from '../ports/operation-queue.js';

export interface CloudTasksQueueConfig {
  project: string;
  location: string;
  queue: string;
  workerUrl: string;
  serviceAccountEmail: string;
}
export class CloudTasksOperationQueue implements OperationQueue {
  private readonly client = new CloudTasksClient();
  /** `path` is the worker route that runs the job; previews use their own route. */
  constructor(
    private readonly config: CloudTasksQueueConfig,
    private readonly path: '/tasks/operations' | '/tasks/previews' = '/tasks/operations',
  ) {}
  async enqueue(message: OperationMessage): Promise<void> {
    const parent = this.client.queuePath(
      this.config.project,
      this.config.location,
      this.config.queue,
    );
    const deliveryId = createHash('sha256')
      .update(`${message.operationId}:${message.traceId}`)
      .digest('hex');
    const name = this.client.taskPath(
      this.config.project,
      this.config.location,
      this.config.queue,
      `${this.path === '/tasks/previews' ? 'preview' : 'operation'}-${deliveryId}`,
    );
    try {
      await this.client.createTask({
        parent,
        task: {
          name,
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.config.workerUrl.replace(/\/$/, '')}${this.path}`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(message)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: this.config.serviceAccountEmail,
              audience: this.config.workerUrl,
            },
          },
          dispatchDeadline: { seconds: 30 * 60 },
        },
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 6
      )
        return;
      throw error;
    }
  }
}
export class DirectOperationQueue implements OperationQueue {
  constructor(private readonly dispatch: (message: OperationMessage) => Promise<void>) {}
  enqueue(message: OperationMessage): Promise<void> {
    queueMicrotask(() => {
      void this.dispatch(message).catch((error: unknown) => {
        console.error('Direct operation dispatch failed', error);
      });
    });
    return Promise.resolve();
  }
}
