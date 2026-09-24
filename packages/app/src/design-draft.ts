import { compileDesignCss } from '@vibelog/core';
import type { BlogDesignSpecV2 } from '@vibelog/core';
import type { ArtifactStore } from './ports/artifact-store.js';

export async function copyPresentationDraft(
  store: ArtifactStore,
  sourceArtifactId: string,
  destinationArtifactId: string,
  design: BlogDesignSpecV2,
  buildIdentity: string,
): Promise<void> {
  const css = compileDesignCss(design);
  await store.copyArtifact(sourceArtifactId, destinationArtifactId);
  await store.putObject(destinationArtifactId, 'design.css', css, { contentType: 'text/css; charset=utf-8' });
  await store.putObject(destinationArtifactId, 'build-identity.json', JSON.stringify({ identity: buildIdentity }), { contentType: 'application/json; charset=utf-8' });
}
