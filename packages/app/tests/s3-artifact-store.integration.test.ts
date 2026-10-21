import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
const endpoint = process.env.TEST_OBJECT_STORE_ENDPOINT;
describe.skipIf(!endpoint)('S3-compatible ArtifactStore', () => {
  const forcePathStyle =
    (process.env.TEST_OBJECT_STORE_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true';
  const store = new S3ArtifactStore({
    endpoint: endpoint ?? '',
    region: process.env.TEST_OBJECT_STORE_REGION ?? 'us-east-1',
    bucket: process.env.TEST_OBJECT_STORE_BUCKET ?? 'vibelog-test',
    accessKeyId: process.env.TEST_OBJECT_STORE_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.TEST_OBJECT_STORE_SECRET_ACCESS_KEY ?? 'minioadmin',
    forcePathStyle,
  });
  const prefix = `_integration/${randomUUID()}`;
  const sourceId = `${prefix}/source`;
  const copyId = `${prefix}/copy`;
  let directory = '';
  let materialized = '';
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vibelog-artifact-test-'));
    materialized = await mkdtemp(join(tmpdir(), 'vibelog-artifact-materialized-'));
    await mkdir(join(directory, 'content', 'blog'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<h1>Hello</h1>');
    await writeFile(join(directory, 'content', 'blog', 'hello.md'), '# Hello');
  });
  afterAll(async () => {
    await Promise.all([store.deleteArtifact(sourceId), store.deleteArtifact(copyId)]);
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await rm(materialized, { recursive: true, force: true });
  });
  it('uploads, materializes, streams, copies and deletes an immutable artifact prefix', async () => {
    await store.uploadDirectory(sourceId, directory);
    const uploaded = await store.readObject(sourceId, 'index.html');
    expect(uploaded).not.toBeNull();
    if (!uploaded) throw new Error('Uploaded object missing');
    expect(await new Response(uploaded.body).text()).toBe('<h1>Hello</h1>');
    await expect(store.listObjects(sourceId)).resolves.toEqual([
      'content/blog/hello.md',
      'index.html',
    ]);
    await store.materializeArtifact(sourceId, materialized);
    await expect(readFile(join(materialized, 'index.html'), 'utf8')).resolves.toBe(
      '<h1>Hello</h1>',
    );
    await expect(readFile(join(materialized, 'content', 'blog', 'hello.md'), 'utf8')).resolves.toBe(
      '# Hello',
    );
    await store.copyArtifact(sourceId, copyId);
    expect(await store.readObject(copyId, 'index.html')).not.toBeNull();
    await expect(store.listObjects(copyId)).resolves.toEqual([
      'content/blog/hello.md',
      'index.html',
    ]);
    await store.deleteArtifact(copyId);
    expect(await store.readObject(copyId, 'index.html')).toBeNull();
  });
  it('round-trips more objects than the concurrency limit without losing or mixing content', async () => {
    const manyId = `${prefix}/many`;
    const manyCopyId = `${prefix}/many-copy`;
    const local = await mkdtemp(join(tmpdir(), 'vibelog-artifact-many-'));
    const out = await mkdtemp(join(tmpdir(), 'vibelog-artifact-many-out-'));
    const paths = Array.from(
      { length: 40 },
      (_, index) => `section-${String(index % 4)}/page-${String(index)}.html`,
    );
    try {
      for (const path of paths) {
        await mkdir(join(local, ...path.split('/').slice(0, -1)), { recursive: true });
        await writeFile(join(local, ...path.split('/')), `<p>${path}</p>`);
      }
      await store.uploadDirectory(manyId, local);
      await store.copyArtifact(manyId, manyCopyId);
      await expect(store.listObjects(manyCopyId)).resolves.toEqual(
        [...paths].sort((left, right) => left.localeCompare(right)),
      );
      await store.materializeArtifact(manyCopyId, out);
      for (const path of paths)
        await expect(readFile(join(out, ...path.split('/')), 'utf8')).resolves.toBe(
          `<p>${path}</p>`,
        );
    } finally {
      await Promise.all([store.deleteArtifact(manyId), store.deleteArtifact(manyCopyId)]);
      await Promise.all([
        rm(local, { recursive: true, force: true }),
        rm(out, { recursive: true, force: true }),
      ]);
    }
  });
});
