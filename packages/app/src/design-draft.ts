import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileDesignCss } from '@vibelog/core';
import type { BlogDesignSpecV2 } from '@vibelog/core';
import { findReusableBuild } from './build-cache.js';
import type { ArtifactStore } from './ports/artifact-store.js';

/** Marks which HTML build an artifact holds; presentation-only design edits keep it valid. */
const CONTENT_IDENTITY_MARKER = 'content-identity.json';
const JSON_TYPE = 'application/json; charset=utf-8';

function contentIdentityMarker(identity: string): string {
  return JSON.stringify({ identity });
}

/** Adds the content marker to a local build output before it is uploaded. */
export async function writeContentIdentity(outputDirectory: string, identity: string) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, CONTENT_IDENTITY_MARKER), contentIdentityMarker(identity));
}

/**
 * Copies a ready static site and restyles it, e.g. when a draft becomes a release. The copied
 * identity markers are kept: they describe the copied HTML, which may predate the current
 * renderer. A copied artifact's design.css is never trusted for previews or publishing.
 */
export async function copyPresentationDraft(
  store: ArtifactStore,
  sourceArtifactId: string,
  destinationArtifactId: string,
  design: BlogDesignSpecV2,
): Promise<void> {
  const css = compileDesignCss(design);
  await store.copyArtifact(sourceArtifactId, destinationArtifactId);
  await store.putObject(destinationArtifactId, 'design.css', css, {
    contentType: 'text/css; charset=utf-8',
  });
}

/**
 * Whether a draft's HTML already matches `contentIdentity`, so a presentation-only edit can
 * reuse it as-is (the preview compiles design.css per request). Drafts built before content
 * markers existed are accepted when their exact build identity matches, and marked for next time.
 */
export async function draftHasContent(
  store: ArtifactStore,
  draftArtifactId: string,
  contentIdentity: string,
  exactBuildIdentity: string,
): Promise<boolean> {
  if (await findReusableBuild(store, [draftArtifactId], contentIdentity, CONTENT_IDENTITY_MARKER))
    return true;
  if (!(await findReusableBuild(store, [draftArtifactId], exactBuildIdentity))) return false;
  await store.putObject(
    draftArtifactId,
    CONTENT_IDENTITY_MARKER,
    contentIdentityMarker(contentIdentity),
    { contentType: JSON_TYPE },
  );
  return true;
}
