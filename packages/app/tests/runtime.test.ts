import { EventEmitter } from 'node:events';
import type { ServerType } from '@hono/node-server';
import { describe, expect, it, vi } from 'vitest';
import { startCombinedRuntime } from '../src/runtime.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeServer(): ServerType {
  return new EventEmitter() as unknown as ServerType;
}

describe('combined runtime', () => {
  it('stops the worker and server before closing the database', async () => {
    const events: string[] = [];
    const workerDone = deferred<undefined>();
    const worker = {
      run: vi.fn(() => workerDone.promise),
      stop: vi.fn(() => { events.push('worker:stop'); workerDone.resolve(undefined); }),
    };
    const closeServer = vi.fn(() => { events.push('server:close'); return Promise.resolve(); });
    const database = { close: vi.fn(() => { events.push('database:close'); }) };
    const runtime = startCombinedRuntime({ server: fakeServer(), worker, database, closeServer });

    await runtime.shutdown('SIGTERM');
    await runtime.done;

    expect(events.at(-1)).toBe('database:close');
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('makes repeated shutdown calls idempotent', async () => {
    const workerDone = deferred<undefined>();
    const worker = { run: () => workerDone.promise, stop: vi.fn(() => { workerDone.resolve(undefined); }) };
    const closeServer = vi.fn(() => Promise.resolve());
    const database = { close: vi.fn() };
    const runtime = startCombinedRuntime({ server: fakeServer(), worker, database, closeServer });

    const first = runtime.shutdown();
    const second = runtime.shutdown();
    expect(second).toBe(first);
    await first;
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('shuts down and rejects when the worker fails', async () => {
    const failure = new Error('worker failed');
    const worker = { run: () => Promise.reject(failure), stop: vi.fn() };
    const closeServer = vi.fn(() => Promise.resolve());
    const database = { close: vi.fn() };
    const runtime = startCombinedRuntime({ server: fakeServer(), worker, database, closeServer });

    await expect(runtime.done).rejects.toBe(failure);
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('shuts down and rejects when the server emits an error', async () => {
    const server = fakeServer();
    const workerDone = deferred<undefined>();
    const failure = new Error('server failed');
    const worker = { run: () => workerDone.promise, stop: vi.fn(() => { workerDone.resolve(undefined); }) };
    const closeServer = vi.fn(() => Promise.resolve());
    const database = { close: vi.fn() };
    const runtime = startCombinedRuntime({ server, worker, database, closeServer });

    server.emit('error', failure);
    await expect(runtime.done).rejects.toBe(failure);
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('propagates HTTP close failures after still closing the database', async () => {
    const workerDone = deferred<undefined>();
    const failure = new Error('close failed');
    const worker = { run: () => workerDone.promise, stop: vi.fn(() => { workerDone.resolve(undefined); }) };
    const database = { close: vi.fn() };
    const runtime = startCombinedRuntime({
      server: fakeServer(),
      worker,
      database,
      closeServer: () => Promise.reject(failure),
    });

    await expect(runtime.shutdown()).rejects.toBe(failure);
    await expect(runtime.done).rejects.toBe(failure);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('propagates database close failures', async () => {
    const workerDone = deferred<undefined>();
    const failure = new Error('database close failed');
    const worker = { run: () => workerDone.promise, stop: vi.fn(() => { workerDone.resolve(undefined); }) };
    const runtime = startCombinedRuntime({
      server: fakeServer(),
      worker,
      database: { close: () => { throw failure; } },
      closeServer: () => Promise.resolve(),
    });

    await expect(runtime.shutdown()).rejects.toBe(failure);
    await expect(runtime.done).rejects.toBe(failure);
  });
});
