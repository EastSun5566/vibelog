export interface StoredObject { body: ReadableStream<Uint8Array>; contentType?: string; etag?: string }
export interface ArtifactStore {
  uploadDirectory(artifactId: string, localDirectory: string): Promise<void>;
  copyArtifact(sourceId: string, destinationId: string): Promise<void>;
  readObject(artifactId: string, path: string): Promise<StoredObject | null>;
  deleteArtifact(artifactId: string): Promise<void>;
}
