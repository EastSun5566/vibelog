import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStoreConfig } from '../config.js';
import type { ArtifactStore, StoredObject } from '../ports/artifact-store.js';

const MIME_TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8' };
function cleanPath(path: string): string {
  const decoded = decodeURIComponent(path.replace(/^\/+/, '') || 'index.html').replaceAll('\\', '/');
  if (decoded.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe object path');
  return decoded;
}
function key(artifactId: string, path?: string): string { return path ? `artifacts/${artifactId}/${cleanPath(path)}` : `artifacts/${artifactId}/`; }
function contentType(path: string): string { return MIME_TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream'; }

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  constructor(private readonly config: ObjectStoreConfig) {
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  }
  async uploadDirectory(artifactId: string, localDirectory: string): Promise<void> {
    const root = resolve(localDirectory);
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolute = resolve(entry.parentPath, entry.name);
      const fromRoot = relative(root, absolute);
      if (fromRoot.startsWith(`..${sep}`)) throw new Error('Artifact file escaped upload root');
      await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key(artifactId, fromRoot.split(sep).join('/')), Body: createReadStream(absolute), ContentType: contentType(fromRoot) }));
    }
  }
  async copyArtifact(sourceId: string, destinationId: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: key(sourceId), ContinuationToken: token }));
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        const destination = `${key(destinationId)}${object.Key.slice(key(sourceId).length)}`;
        const source = [this.config.bucket, ...object.Key.split('/')].map(encodeURIComponent).join('/');
        await this.client.send(new CopyObjectCommand({ Bucket: this.config.bucket, Key: destination, CopySource: source }));
      }
      token = page.NextContinuationToken;
    } while (token);
  }
  async readObject(artifactId: string, path: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key(artifactId, path) }));
      if (!response.Body) return null;
      return { body: response.Body.transformToWebStream() as ReadableStream<Uint8Array>, contentType: response.ContentType, etag: response.ETag };
    } catch (error) {
      if (error && typeof error === 'object' && ('$metadata' in error) && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  async deleteArtifact(artifactId: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: key(artifactId), ContinuationToken: token }));
      const objects = (page.Contents ?? []).flatMap((object) => object.Key ? [{ Key: object.Key }] : []);
      if (objects.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.config.bucket, Delete: { Objects: objects, Quiet: true } }));
      token = page.NextContinuationToken;
    } while (token);
  }
}
