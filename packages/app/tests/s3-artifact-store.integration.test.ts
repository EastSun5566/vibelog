import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
const endpoint = process.env.TEST_OBJECT_STORE_ENDPOINT;
describe.skipIf(!endpoint)('S3-compatible ArtifactStore', () => {
  const forcePathStyle = (process.env.TEST_OBJECT_STORE_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true';
  const store = new S3ArtifactStore({ endpoint: endpoint ?? '', region: process.env.TEST_OBJECT_STORE_REGION ?? 'us-east-1', bucket: process.env.TEST_OBJECT_STORE_BUCKET ?? 'vibelog-test', accessKeyId: process.env.TEST_OBJECT_STORE_ACCESS_KEY_ID ?? 'minioadmin', secretAccessKey: process.env.TEST_OBJECT_STORE_SECRET_ACCESS_KEY ?? 'minioadmin', forcePathStyle });
  const prefix = `_integration/${randomUUID()}`;
  const sourceId = `${prefix}/source`;
  const copyId = `${prefix}/copy`;
  let directory = '';
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'vibelog-artifact-test-')); await writeFile(join(directory, 'index.html'), '<h1>Hello</h1>'); });
  afterAll(async () => { await Promise.all([store.deleteArtifact(sourceId), store.deleteArtifact(copyId)]); await rm(directory, { recursive: true, force: true }); });
  it('uploads, streams, copies and deletes an immutable artifact prefix', async () => {
    await store.uploadDirectory(sourceId, directory);
    const uploaded = await store.readObject(sourceId, 'index.html'); expect(uploaded).not.toBeNull();
    if (!uploaded) throw new Error('Uploaded object missing');
    expect(await new Response(uploaded.body).text()).toBe('<h1>Hello</h1>');
    await store.copyArtifact(sourceId, copyId); expect(await store.readObject(copyId, 'index.html')).not.toBeNull();
    await store.deleteArtifact(copyId); expect(await store.readObject(copyId, 'index.html')).toBeNull();
  });
});
