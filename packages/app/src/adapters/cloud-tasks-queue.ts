import { CloudTasksClient } from '@google-cloud/tasks';
import type { OperationMessage, OperationQueue } from '../ports/operation-queue.js';

export interface CloudTasksQueueConfig { project: string; location: string; queue: string; workerUrl: string; serviceAccountEmail: string }
export class CloudTasksOperationQueue implements OperationQueue {
  private readonly client = new CloudTasksClient();
  constructor(private readonly config: CloudTasksQueueConfig) {}
  async enqueue(message: OperationMessage): Promise<void> {
    const parent = this.client.queuePath(this.config.project, this.config.location, this.config.queue);
    const name = this.client.taskPath(this.config.project, this.config.location, this.config.queue, `operation-${message.operationId}`);
    try {
      await this.client.createTask({ parent, task: { name, httpRequest: { httpMethod: 'POST', url: `${this.config.workerUrl.replace(/\/$/, '')}/tasks/operations`, headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify(message)).toString('base64'), oidcToken: { serviceAccountEmail: this.config.serviceAccountEmail, audience: this.config.workerUrl } }, dispatchDeadline: { seconds: 30 * 60 } } });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 6) return;
      throw error;
    }
  }
}
export class DirectOperationQueue implements OperationQueue {
  constructor(private readonly dispatch: (message: OperationMessage) => Promise<void>) {}
  enqueue(message: OperationMessage): Promise<void> {
    queueMicrotask(() => { void this.dispatch(message).catch((error: unknown) => { console.error('Direct operation dispatch failed', error); }); });
    return Promise.resolve();
  }
}
