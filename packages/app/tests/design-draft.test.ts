import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN_V2 } from '@vibelog/core';
import { copyPresentationDraft } from '../src/design-draft.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

describe('presentation-only draft artifact', () => {
  it('copies the ready static site and updates its design stylesheet and exact build identity', async () => {
    const calls: string[] = [];
    const copyArtifact = vi.fn(() => { calls.push('copy'); return Promise.resolve(); });
    const putObject = vi.fn((_id: string, path: string) => { calls.push(`put:${path}`); return Promise.resolve(); });
    const materializeArtifact = vi.fn();
    const uploadDirectory = vi.fn();
    const store: ArtifactStore = {
      uploadDirectory,
      materializeArtifact,
      copyArtifact,
      putObject,
      listObjects: vi.fn(),
      readObject: vi.fn(),
      deleteArtifact: vi.fn(),
    };
    await copyPresentationDraft(store, 'ready-draft', 'candidate', DEFAULT_DESIGN_V2, 'new-build-identity');
    expect(calls).toEqual(['copy', 'put:design.css', 'put:build-identity.json']);
    expect(copyArtifact).toHaveBeenCalledWith('ready-draft', 'candidate');
    expect(putObject).toHaveBeenCalledWith('candidate', 'design.css', expect.stringContaining('--theme-background'), { contentType: 'text/css; charset=utf-8' });
    expect(putObject).toHaveBeenCalledWith('candidate', 'build-identity.json', '{"identity":"new-build-identity"}', { contentType: 'application/json; charset=utf-8' });
    expect(materializeArtifact).not.toHaveBeenCalled();
    expect(uploadDirectory).not.toHaveBeenCalled();
  });

  it('does not copy an invalid design or write CSS if the copy fails', async () => {
    const copyArtifact = vi.fn(() => Promise.reject(new Error('R2 unavailable')));
    const putObject = vi.fn();
    const store: ArtifactStore = {
      uploadDirectory: vi.fn(), materializeArtifact: vi.fn(),
      copyArtifact,
      putObject, listObjects: vi.fn(), readObject: vi.fn(), deleteArtifact: vi.fn(),
    };
    await expect(copyPresentationDraft(store, 'ready', 'candidate', DEFAULT_DESIGN_V2, 'identity')).rejects.toThrow('R2 unavailable');
    expect(putObject).not.toHaveBeenCalled();
    const invalid = structuredClone(DEFAULT_DESIGN_V2);
    invalid.theme.colors.text = invalid.theme.colors.background;
    await expect(copyPresentationDraft(store, 'ready', 'candidate', invalid, 'identity')).rejects.toThrow();
    expect(copyArtifact).toHaveBeenCalledTimes(1);
  });
});
