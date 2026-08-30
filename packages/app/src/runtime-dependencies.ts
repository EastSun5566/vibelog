import { CloudTasksOperationQueue, DirectOperationQueue } from './adapters/cloud-tasks-queue.js';
import { MailpitTransactionalEmailSender } from './adapters/mailpit-email.js';
import { ResendTransactionalEmailSender } from './adapters/resend-email.js';
import { S3ArtifactStore } from './adapters/s3-artifact-store.js';
import type { AppConfig, OperationRuntimeConfig } from './config.js';
import { AppDatabase } from './database.js';
import { AppOperationExecutor, DeferredOutboxDispatcher, DurableOutboxWorker, OutboxDispatcher } from './jobs.js';

function createCoreRuntimeDependencies(config: OperationRuntimeConfig) {
  const database = new AppDatabase(config.databaseUrl);
  const artifactStore = new S3ArtifactStore(config.objectStore);
  const executor = new AppOperationExecutor(database, artifactStore, config);
  return { database, artifactStore, executor };
}
export function createWebRuntimeDependencies(config: AppConfig) {
  const core = createCoreRuntimeDependencies(config);
  const emailSender = config.email.provider === 'mailpit'
    ? new MailpitTransactionalEmailSender(config.email.apiUrl, config.emailFrom, config.emailReplyTo)
    : new ResendTransactionalEmailSender(config.email.apiKey, config.emailFrom, config.emailReplyTo);
  if (config.queueMode === 'postgres') return { ...core, dispatcher: new DeferredOutboxDispatcher(), emailSender };
  const queue = config.cloudTasks
    ? new CloudTasksOperationQueue(config.cloudTasks)
    : new DirectOperationQueue(async (message) => { await core.executor.execute(message.operationId); });
  return { ...core, queue, dispatcher: new OutboxDispatcher(core.database, queue), emailSender };
}
export function createWorkerRuntimeDependencies(config: OperationRuntimeConfig) {
  const core = createCoreRuntimeDependencies(config);
  if (config.queueMode === 'postgres') {
    const dispatcher = new DurableOutboxWorker(core.database, core.executor);
    return { ...core, dispatcher, durableWorker: dispatcher };
  }
  const queue = config.cloudTasks
    ? new CloudTasksOperationQueue(config.cloudTasks)
    : new DirectOperationQueue(async (message) => { await core.executor.execute(message.operationId); });
  return { ...core, queue, dispatcher: new OutboxDispatcher(core.database, queue) };
}
