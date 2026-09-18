import { PassThrough, Readable } from 'node:stream';
import ZipStream from 'zip-stream';
import type { ArtifactStore } from './ports/artifact-store.js';

const ARCHIVE_DATE = new Date('1980-01-01T00:00:00.000Z');

export class ArtifactExportError extends Error {}

function safeArchivePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ArtifactExportError('Artifact contains an unsafe path');
  }
  return path;
}

function appendEntry(archive: ZipStream, source: Readable, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    archive.entry(source, { name, date: ARCHIVE_DATE }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function createArtifactZip(store: ArtifactStore, artifactId: string): Promise<ReadableStream<Uint8Array>> {
  const paths = (await store.listObjects(artifactId)).map(safeArchivePath);
  if (paths.length === 0) throw new ArtifactExportError('Published artifact is empty');

  const archive = new ZipStream({ zlib: { level: 9 } });
  const output = new PassThrough();
  const fail = (error: Error) => output.destroy(error);
  archive.on('error', fail);
  archive.pipe(output);

  void (async () => {
    for (const path of paths) {
      const object = await store.readObject(artifactId, path);
      if (!object) throw new ArtifactExportError(`Published artifact is missing ${path}`);
      await appendEntry(archive, Readable.fromWeb(object.body as import('node:stream/web').ReadableStream<Uint8Array>), path);
    }
    archive.finalize();
  })().catch((error: unknown) => {
    const failure = error instanceof Error ? error : new ArtifactExportError('Could not create archive');
    archive.destroy(failure);
    output.destroy(failure);
  });

  return Readable.toWeb(output) as ReadableStream<Uint8Array>;
}
