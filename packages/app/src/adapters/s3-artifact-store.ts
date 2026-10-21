import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStoreConfig } from '../config.js';
import type { ArtifactStore, StoredObject } from '../ports/artifact-store.js';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  xml: 'application/xml; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
};
function cleanPath(path: string): string {
  const decoded = decodeURIComponent(path.replace(/^\/+/, '') || 'index.html').replaceAll(
    '\\',
    '/',
  );
  if (decoded.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error('Unsafe object path');
  return decoded;
}
function key(artifactId: string, path?: string): string {
  return path ? `artifacts/${artifactId}/${cleanPath(path)}` : `artifacts/${artifactId}/`;
}
function contentType(path: string): string {
  return MIME_TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
// Runs at most `limit` tasks at once. After the first failure no new tasks start; in-flight
// tasks are awaited so nothing keeps writing after the call rejects with that first error.
async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
}

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  private readonly concurrency: number;
  constructor(
    private readonly config: ObjectStoreConfig,
    options: { concurrency?: number } = {},
  ) {
    this.concurrency = Math.max(1, options.concurrency ?? 16);
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  async uploadDirectory(artifactId: string, localDirectory: string): Promise<void> {
    const root = resolve(localDirectory);
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const files = entries.flatMap((entry) => {
      if (!entry.isFile()) return [];
      const absolute = resolve(entry.parentPath, entry.name);
      const fromRoot = relative(root, absolute);
      if (fromRoot.startsWith(`..${sep}`)) throw new Error('Artifact file escaped upload root');
      return [{ absolute, fromRoot }];
    });
    await forEachLimit(files, this.concurrency, async ({ absolute, fromRoot }) => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key(artifactId, fromRoot.split(sep).join('/')),
          Body: createReadStream(absolute),
          ContentType: contentType(fromRoot),
        }),
      );
    });
  }
  async materializeArtifact(artifactId: string, localDirectory: string): Promise<void> {
    const root = resolve(localDirectory);
    await mkdir(root, { recursive: true });
    const files = (await this.listObjects(artifactId)).map((path) => {
      const safePath = cleanPath(path);
      const absolute = resolve(root, ...safePath.split('/'));
      const fromRoot = relative(root, absolute);
      if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..')
        throw new Error('Artifact object escaped materialization root');
      return { safePath, absolute };
    });
    // Create every parent directory before the concurrent writes so they never race on mkdir.
    for (const directory of new Set(files.map(({ absolute }) => resolve(absolute, '..'))))
      await mkdir(directory, { recursive: true });
    await forEachLimit(files, this.concurrency, async ({ safePath, absolute }) => {
      const object = await this.readObject(artifactId, safePath);
      if (!object)
        throw new Error(`Artifact object disappeared during materialization: ${safePath}`);
      await writeFile(absolute, Buffer.from(await new Response(object.body).arrayBuffer()));
    });
  }
  async copyArtifact(sourceId: string, destinationId: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: key(sourceId),
          ContinuationToken: token,
        }),
      );
      const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
      await forEachLimit(keys, this.concurrency, async (objectKey) => {
        const destination = `${key(destinationId)}${objectKey.slice(key(sourceId).length)}`;
        const source = [this.config.bucket, ...objectKey.split('/')]
          .map(encodeURIComponent)
          .join('/');
        await this.client.send(
          new CopyObjectCommand({
            Bucket: this.config.bucket,
            Key: destination,
            CopySource: source,
          }),
        );
      });
      token = page.NextContinuationToken;
    } while (token);
  }
  async putObject(
    artifactId: string,
    path: string,
    body: string | Uint8Array,
    options: { contentType?: string } = {},
  ): Promise<void> {
    if (!path || path.startsWith('/'))
      throw new Error('Object path must be relative and non-empty');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key(artifactId, path),
        Body: body,
        ContentType: options.contentType ?? contentType(path),
      }),
    );
  }
  async listObjects(artifactId: string): Promise<string[]> {
    const prefix = key(artifactId);
    const paths: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Key === prefix) continue;
        const path = object.Key.slice(prefix.length);
        if (cleanPath(path) !== path) throw new Error('Unsafe stored object path');
        paths.push(path);
      }
      token = page.NextContinuationToken;
    } while (token);
    return paths.sort((left, right) => left.localeCompare(right));
  }
  async readObject(artifactId: string, path: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key(artifactId, path) }),
      );
      if (!response.Body) return null;
      return {
        body: response.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        '$metadata' in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
  }
  async deleteArtifact(artifactId: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: key(artifactId),
          ContinuationToken: token,
        }),
      );
      const objects = (page.Contents ?? []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      );
      if (objects.length)
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      token = page.NextContinuationToken;
    } while (token);
  }
}
