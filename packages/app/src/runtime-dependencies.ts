import { CloudTasksOperationQueue, DirectOperationQueue } from './adapters/cloud-tasks-queue.js';
import { MailpitTransactionalEmailSender } from './adapters/mailpit-email.js';
import { ResendTransactionalEmailSender } from './adapters/resend-email.js';
import { S3ArtifactStore } from './adapters/s3-artifact-store.js';
import type { AppConfig, OperationRuntimeConfig } from './config.js';
import { AppDatabase } from './database.js';
import {
  AppOperationExecutor,
  DeferredOutboxDispatcher,
  DurableOutboxWorker,
  OutboxDispatcher,
} from './jobs.js';
import { DurablePreviewWorker, ProfilePreviewExecutor } from './profile-preview-jobs.js';
import { ProfilePreviewStore } from './profile-preview.js';

function createCoreRuntimeDependencies(config: OperationRuntimeConfig) {
  const database = new AppDatabase(config.databaseUrl);
  const artifactStore = new S3ArtifactStore(config.objectStore);
  const executor = new AppOperationExecutor(database, artifactStore, config);
  const previews = new ProfilePreviewStore(database);
  const previewExecutor = new ProfilePreviewExecutor(previews, artifactStore, config);
  return { database, artifactStore, executor, previews, previewExecutor };
}
export function createWebRuntimeDependencies(config: AppConfig) {
  const core = createCoreRuntimeDependencies(config);
  const emailSender =
    config.email.provider === 'mailpit'
      ? new MailpitTransactionalEmailSender(
          config.email.apiUrl,
          config.emailFrom,
          config.emailReplyTo,
        )
      : new ResendTransactionalEmailSender(
          config.email.apiKey,
          config.emailFrom,
          config.emailReplyTo,
        );
  // With PostgreSQL polling the worker picks up queued previews itself.
  if (config.queueMode === 'postgres')
    return {
      ...core,
      dispatcher: new DeferredOutboxDispatcher(),
      previewQueue: null,
      emailSender,
    };
  const queue = config.cloudTasks
    ? new CloudTasksOperationQueue(config.cloudTasks)
    : new DirectOperationQueue(async (message) => {
        await core.executor.execute(message.operationId);
      });
  const previewQueue = config.cloudTasks
    ? new CloudTasksOperationQueue(config.cloudTasks, '/tasks/previews')
    : new DirectOperationQueue(async (message) => {
        await core.previewExecutor.execute(message.operationId);
      });
  return {
    ...core,
    queue,
    dispatcher: new OutboxDispatcher(core.database, queue),
    previewQueue,
    emailSender,
  };
}
export function createWorkerRuntimeDependencies(config: OperationRuntimeConfig) {
  const core = createCoreRuntimeDependencies(config);
  if (config.queueMode === 'postgres') {
    const dispatcher = new DurableOutboxWorker(core.database, core.executor);
    const previewWorker = new DurablePreviewWorker(core.previews, core.previewExecutor);
    const durableWorker = {
      dispatch: async (limit?: number) =>
        (await dispatcher.dispatch(limit)) + (await previewWorker.dispatch()),
    };
    return { ...core, dispatcher, durableWorker };
  }
  const queue = config.cloudTasks
    ? new CloudTasksOperationQueue(config.cloudTasks)
    : new DirectOperationQueue(async (message) => {
        await core.executor.execute(message.operationId);
      });
  return { ...core, queue, dispatcher: new OutboxDispatcher(core.database, queue) };
}
