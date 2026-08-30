import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
const endpoint = process.env.TEST_OBJECT_STORE_ENDPOINT;
describe.skipIf(!endpoint)('S3-compatible ArtifactStore against MinIO', () => {
  const store = new S3ArtifactStore({ endpoint: endpoint ?? '', region: process.env.TEST_OBJECT_STORE_REGION ?? 'us-east-1', bucket: process.env.TEST_OBJECT_STORE_BUCKET ?? 'vibelog-test', accessKeyId: process.env.TEST_OBJECT_STORE_ACCESS_KEY_ID ?? 'minioadmin', secretAccessKey: process.env.TEST_OBJECT_STORE_SECRET_ACCESS_KEY ?? 'minioadmin', forcePathStyle: true });
  let directory = '';
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'vibelog-artifact-test-')); await writeFile(join(directory, 'index.html'), '<h1>Hello</h1>'); });
  afterAll(async () => { await Promise.all([store.deleteArtifact('contract-source'), store.deleteArtifact('contract-copy')]); await rm(directory, { recursive: true, force: true }); });
  it('uploads, streams, copies and deletes an immutable artifact prefix', async () => {
    await store.uploadDirectory('contract-source', directory);
    const uploaded = await store.readObject('contract-source', 'index.html'); expect(uploaded).not.toBeNull();
    if (!uploaded) throw new Error('Uploaded object missing');
    expect(await new Response(uploaded.body).text()).toBe('<h1>Hello</h1>');
    await store.copyArtifact('contract-source', 'contract-copy'); expect(await store.readObject('contract-copy', 'index.html')).not.toBeNull();
    await store.deleteArtifact('contract-copy'); expect(await store.readObject('contract-copy', 'index.html')).toBeNull();
  });
});
