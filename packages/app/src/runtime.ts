import type { ServerType } from '@hono/node-server';
import type { AppDatabase } from './database.js';
import type { OperationWorker } from './jobs.js';
import { closeHttpServer } from './server-runtime.js';

interface CombinedRuntimeOptions {
  server: ServerType;
  worker: Pick<OperationWorker, 'run' | 'stop'>;
  database: Pick<AppDatabase, 'close'>;
  closeServer?: (server: ServerType) => Promise<void>;
}

export interface CombinedRuntime {
  done: Promise<void>;
  shutdown(signal?: NodeJS.Signals): Promise<void>;
}

export function startCombinedRuntime(options: CombinedRuntimeOptions): CombinedRuntime {
  const { server, worker, database, closeServer = closeHttpServer } = options;
  let stopping = false;
  let shutdownPromise: Promise<void> | undefined;
  let failure: { error: unknown } | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const workerPromise = worker.run();

  const rememberFailure = (error: unknown): void => {
    failure ??= { error };
  };

  const onServerError = (error: Error): void => {
    rememberFailure(error);
    void beginShutdown();
  };

  const beginShutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    worker.stop();
    shutdownPromise = (async () => {
      const [serverResult, workerResult] = await Promise.allSettled([
        closeServer(server),
        workerPromise,
      ]);
      let databaseFailure: { error: unknown } | undefined;
      try {
        database.close();
      } catch (error) {
        databaseFailure = { error };
      }
      server.off('error', onServerError);

      if (failure) throw failure.error;
      if (serverResult.status === 'rejected') throw serverResult.reason;
      if (workerResult.status === 'rejected') throw workerResult.reason;
      if (databaseFailure) throw databaseFailure.error;
    })();
    void shutdownPromise.then(resolveDone, rejectDone);
    return shutdownPromise;
  };

  server.once('error', onServerError);
  void workerPromise.then(
    () => {
      if (!stopping) {
        rememberFailure(new Error('VibeLog worker stopped unexpectedly'));
        void beginShutdown();
      }
    },
    (error: unknown) => {
      rememberFailure(error);
      void beginShutdown();
    },
  );

  return {
    done,
    shutdown(signal) {
      if (signal && !stopping) console.log(`Received ${signal}; stopping VibeLog SaaS and worker`);
      return beginShutdown();
    },
  };
}
