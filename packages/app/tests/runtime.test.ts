import { EventEmitter } from 'node:events';
import type { ServerType } from '@hono/node-server';
import { describe, expect, it, vi } from 'vitest';
import { startCombinedRuntime } from '../src/runtime.js';

function fakeServer(): ServerType {
  return new EventEmitter() as ServerType;
}

describe('combined app runtime', () => {
  it('stops the server and worker before closing the database', async () => {
    const events: string[] = [];
    let finishWorker!: () => void;
    const workerDone = new Promise<void>((resolve) => { finishWorker = resolve; });
    const worker = {
      run: vi.fn(() => workerDone),
      stop: vi.fn(() => {
        events.push('worker:stop');
        finishWorker();
      }),
    };
    const database = { close: vi.fn(() => { events.push('database:close'); }) };
    const closeServer = vi.fn(() => {
      events.push('server:close');
      return Promise.resolve();
    });
    const runtime = startCombinedRuntime({
      server: fakeServer(),
      worker,
      database,
      closeServer,
    });

    await runtime.shutdown();
    await runtime.done;
    await runtime.shutdown();

    expect(events).toEqual(['worker:stop', 'server:close', 'database:close']);
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('shuts down the container runtime when the worker crashes', async () => {
    const failure = new Error('worker crashed');
    const worker = {
      run: vi.fn(() => Promise.reject(failure)),
      stop: vi.fn(),
    };
    const database = { close: vi.fn() };
    const closeServer = vi.fn(() => Promise.resolve());
    const runtime = startCombinedRuntime({
      server: fakeServer(),
      worker,
      database,
      closeServer,
    });

    await expect(runtime.done).rejects.toBe(failure);
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(closeServer).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });
});
