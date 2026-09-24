export interface StoredObject { body: ReadableStream<Uint8Array>; contentType?: string; etag?: string }
export interface ArtifactStore {
  uploadDirectory(artifactId: string, localDirectory: string): Promise<void>;
  materializeArtifact(artifactId: string, localDirectory: string): Promise<void>;
  copyArtifact(sourceId: string, destinationId: string): Promise<void>;
  putObject(artifactId: string, path: string, body: string | Uint8Array, options?: { contentType?: string }): Promise<void>;
  listObjects(artifactId: string): Promise<string[]>;
  readObject(artifactId: string, path: string): Promise<StoredObject | null>;
  deleteArtifact(artifactId: string): Promise<void>;
}
