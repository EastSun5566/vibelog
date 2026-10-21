import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

interface Command {
  input: Record<string, unknown>;
}
const send = vi.hoisted(() => vi.fn<(command: Command) => Promise<unknown>>());
vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = send;
  },
}));
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';

const config = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'bucket',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  forcePathStyle: true,
};

// Tracks how many fake S3 calls of one kind are in flight; each call yields a few macrotasks
// so overlapping calls have a chance to pile up if the store does not bound them.
function inFlightTracker() {
  const state = { active: 0, peak: 0, calls: [] as Command[] };
  const run = async <T>(command: Command, result: () => T): Promise<T> => {
    state.calls.push(command);
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    try {
      for (let tick = 0; tick < 3; tick++) await new Promise((done) => setImmediate(done));
      return result();
    } finally {
      state.active--;
    }
  };
  return { state, run };
}
function listing(keys: string[], NextContinuationToken?: string) {
  return { Contents: keys.map((Key) => ({ Key })), NextContinuationToken };
}
function body(text: string) {
  return {
    Body: { transformToWebStream: () => new Response(text).body },
    ContentType: 'text/plain',
  };
}

let directory = '';
beforeEach(async () => {
  send.mockReset();
  directory = await mkdtemp(join(tmpdir(), 'vibelog-s3-store-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('S3ArtifactStore bounded concurrency', () => {
  it('uploads a directory with at most the configured number of PutObject calls in flight', async () => {
    await mkdir(join(directory, 'nested', 'deeper'), { recursive: true });
    const names = Array.from({ length: 20 }, (_, index) => `page-${String(index)}.html`);
    await Promise.all([
      ...names.map((name) => writeFile(join(directory, name), name)),
      writeFile(join(directory, 'nested', 'deeper', 'style.css'), 'body{}'),
    ]);
    const tracker = inFlightTracker();
    send.mockImplementation((command) => tracker.run(command, () => ({})));

    await new S3ArtifactStore(config, { concurrency: 4 }).uploadDirectory('site', directory);

    expect(tracker.state.peak).toBe(4);
    expect(tracker.state.calls.every((call) => call instanceof PutObjectCommand)).toBe(true);
    expect(tracker.state.calls.map((call) => call.input.Key).sort()).toEqual(
      [
        ...names.map((name) => `artifacts/site/${name}`),
        'artifacts/site/nested/deeper/style.css',
      ].sort(),
    );
    const css = tracker.state.calls.find((call) => String(call.input.Key).endsWith('.css'));
    expect(css?.input.ContentType).toBe('text/css; charset=utf-8');
  });

  it('defaults to 16 concurrent requests', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        writeFile(join(directory, `${String(index)}.txt`), 'x'),
      ),
    );
    const tracker = inFlightTracker();
    send.mockImplementation((command) => tracker.run(command, () => ({})));

    await new S3ArtifactStore(config).uploadDirectory('site', directory);

    expect(tracker.state.calls).toHaveLength(40);
    expect(tracker.state.peak).toBe(16);
  });

  it('rejects with the first upload failure, starts no new uploads and waits for in-flight ones', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        writeFile(join(directory, `${String(index)}.txt`), 'x'),
      ),
    );
    const tracker = inFlightTracker();
    let failed = false;
    send.mockImplementation((command) =>
      tracker.run(command, () => {
        if (!failed && tracker.state.calls.length >= 3) {
          failed = true;
          throw new Error('R2 unavailable');
        }
        return {};
      }),
    );

    await expect(
      new S3ArtifactStore(config, { concurrency: 3 }).uploadDirectory('site', directory),
    ).rejects.toThrow('R2 unavailable');
    expect(tracker.state.active).toBe(0);
    expect(tracker.state.calls.length).toBeLessThan(30);
  });

  it('copies every page of a paginated listing with bounded concurrency', async () => {
    const pages = [
      listing(
        Array.from({ length: 10 }, (_, index) => `artifacts/src/a-${String(index)}.html`),
        'page-2',
      ),
      listing(['artifacts/src/assets/b c.css', 'artifacts/src/z.js']),
    ];
    const tracker = inFlightTracker();
    send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command) {
        const page = command.input.ContinuationToken === 'page-2' ? pages[1] : pages[0];
        return Promise.resolve(page);
      }
      return tracker.run(command, () => ({}));
    });

    await new S3ArtifactStore(config, { concurrency: 3 }).copyArtifact('src', 'dst');

    const listCalls = send.mock.calls.filter(([call]) => call instanceof ListObjectsV2Command);
    expect(listCalls.map(([call]) => call.input.ContinuationToken)).toEqual([undefined, 'page-2']);
    expect(tracker.state.peak).toBe(3);
    expect(tracker.state.calls.every((call) => call instanceof CopyObjectCommand)).toBe(true);
    expect(tracker.state.calls).toHaveLength(12);
    expect(
      tracker.state.calls.find((call) => call.input.Key === 'artifacts/dst/assets/b c.css'),
    ).toMatchObject({ input: { CopySource: 'bucket/artifacts/src/assets/b%20c.css' } });
  });

  it('stops paginating and rejects when a copy fails', async () => {
    send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command)
        return Promise.resolve(listing(['artifacts/src/a.html', 'artifacts/src/b.html'], 'next'));
      return Promise.reject(new Error('copy failed'));
    });

    await expect(new S3ArtifactStore(config).copyArtifact('src', 'dst')).rejects.toThrow(
      'copy failed',
    );
    expect(send.mock.calls.filter(([call]) => call instanceof ListObjectsV2Command)).toHaveLength(
      1,
    );
  });

  it('materializes nested objects concurrently and creates their parent directories', async () => {
    const objects: Record<string, string> = {
      'index.html': '<h1>Hi</h1>',
      'content/blog/a.md': '# A',
      'content/blog/b.md': '# B',
      'content/blog/deep/c.md': '# C',
      'assets/app.css': 'body{}',
    };
    const tracker = inFlightTracker();
    send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command)
        return Promise.resolve(
          listing(Object.keys(objects).map((path) => `artifacts/site/${path}`)),
        );
      if (command instanceof GetObjectCommand)
        return tracker.run(command, () =>
          body(objects[String(command.input.Key).slice('artifacts/site/'.length)] ?? ''),
        );
      throw new Error('unexpected command');
    });
    const target = join(directory, 'out');

    await new S3ArtifactStore(config, { concurrency: 2 }).materializeArtifact('site', target);

    expect(tracker.state.peak).toBe(2);
    for (const [path, text] of Object.entries(objects))
      await expect(readFile(join(target, ...path.split('/')), 'utf8')).resolves.toBe(text);
  });

  it('rejects materialization when an object disappears mid-flight', async () => {
    send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command)
        return Promise.resolve(listing(['artifacts/site/a.html', 'artifacts/site/gone.html']));
      if (String(command.input.Key).endsWith('gone.html'))
        return Promise.reject(
          Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } }),
        );
      return Promise.resolve(body('a'));
    });

    await expect(
      new S3ArtifactStore(config).materializeArtifact('site', join(directory, 'out')),
    ).rejects.toThrow('Artifact object disappeared during materialization: gone.html');
  });

  it('rejects unsafe stored paths before reading any object', async () => {
    send.mockImplementation((command) => {
      if (command instanceof ListObjectsV2Command)
        return Promise.resolve(listing(['artifacts/site/a.html', 'artifacts/site/%2e%2e/evil']));
      return Promise.resolve(body('x'));
    });

    await expect(
      new S3ArtifactStore(config).materializeArtifact('site', join(directory, 'out')),
    ).rejects.toThrow('Unsafe');
    expect(send.mock.calls.some(([call]) => call instanceof GetObjectCommand)).toBe(false);
  });
});
