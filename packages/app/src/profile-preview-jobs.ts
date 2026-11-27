import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_DESIGN_V2,
  HackMdSource,
  buildBlog,
  createDevBuilder,
  searchIndexIdentity,
  structuralBuildIdentity,
  writeSourceSnapshot,
} from '@vibelog/core';
import type { ContentSource } from '@vibelog/core';
import type { OperationRuntimeConfig } from './config.js';
import { applyDesignPreset } from './design-presets.js';
import { operationPublicError } from './jobs.js';
import type { ArtifactStore } from './ports/artifact-store.js';
import type {
  OperationDispatcher,
  OperationExecutor,
  OperationResult,
} from './ports/operation-queue.js';
import {
  PreviewLeaseLostError,
  type ProfilePreviewRecord,
  type ProfilePreviewStore,
  guessLanguage,
  pickPreset,
  previewSiteOrigin,
} from './profile-preview.js';

/**
 * Builds the anonymous preview for one HackMD profile. Every failure is terminal for the job:
 * the visitor sees the message, and a later visit may try again.
 */
export class ProfilePreviewExecutor implements OperationExecutor {
  constructor(
    private readonly previews: ProfilePreviewStore,
    private readonly artifacts: ArtifactStore,
    private readonly config: Pick<OperationRuntimeConfig, 'appOrigin' | 'hackmdBaseUrl'>,
    private readonly dependencies: { contentSource?: (username: string) => ContentSource } = {},
  ) {}

  async execute(previewId: string): Promise<OperationResult> {
    const lease = await this.previews.claim(previewId);
    if (!lease) return { duplicate: true };
    const sourceArtifactId = randomUUID();
    const draftArtifactId = randomUUID();
    const work = await mkdtemp(join(tmpdir(), 'vibelog-preview-'));
    try {
      const result = await this.build(lease, work, sourceArtifactId, draftArtifactId);
      const superseded = await this.previews.complete(lease, result);
      await Promise.allSettled(superseded.map((id) => this.artifacts.deleteArtifact(id)));
      return { message: 'Preview ready' };
    } catch (error) {
      await Promise.allSettled(
        [sourceArtifactId, draftArtifactId].map((id) => this.artifacts.deleteArtifact(id)),
      );
      if (error instanceof PreviewLeaseLostError) return { duplicate: true };
      console.error(
        `[preview:${lease.id}] build failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      await this.previews.fail(lease, operationPublicError('sync', error));
      return { failed: true };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async build(
    lease: ProfilePreviewRecord,
    work: string,
    sourceArtifactId: string,
    draftArtifactId: string,
  ) {
    const source =
      this.dependencies.contentSource?.(lease.hackmdUsername) ??
      new HackMdSource(lease.hackmdUsername, { baseUrl: this.config.hackmdBaseUrl });
    const [{ posts }, author] = await Promise.all([source.getPosts(), source.getAuthor()]);
    const site = {
      title: `${author.name}'s blog`,
      description: author.bio,
      language: guessLanguage(posts.map((post) => post.title)),
    };
    await writeFile(join(work, 'vibelog.config.json'), JSON.stringify({ site }), { mode: 0o600 });
    const builder = createDevBuilder({
      root: work,
      contentSource: {
        name: source.name,
        getPosts: () => Promise.resolve({ posts }),
        getAuthor: () => Promise.resolve(author),
      },
    });
    await builder.prepare({ installDependencies: false });
    const summary = await builder.fetchContent({ excludedSlugs: [] });
    await this.previews.setStage(lease, 'Building your blog');
    const sourceDirectory = join(work, 'source');
    await writeSourceSnapshot(builder.vibelogDir, sourceDirectory, summary);
    await this.artifacts.uploadDirectory(sourceArtifactId, sourceDirectory);
    const design = applyDesignPreset(DEFAULT_DESIGN_V2, pickPreset(summary.contentProfile));
    const siteOrigin = previewSiteOrigin(this.config.appOrigin, lease.label);
    const compileRoot = join(work, 'compile');
    const output = join(compileRoot, 'dist');
    await buildBlog({
      sourceDir: sourceDirectory,
      design,
      workDir: compileRoot,
      outDir: output,
      site: siteOrigin,
      searchIdentity: searchIndexIdentity(sourceArtifactId, siteOrigin),
      buildIdentity: structuralBuildIdentity(sourceArtifactId, design, siteOrigin),
    });
    await this.previews.setStage(lease, 'Almost there');
    await this.artifacts.uploadDirectory(draftArtifactId, output);
    return {
      sourceArtifactId,
      draftArtifactId,
      design,
      designSource: 'preset' as const,
      title: site.title,
      author: summary.author.name,
      contentProfile: summary.contentProfile,
    };
  }

  /** Removes previews that expired long ago, with their stored builds. */
  async cleanupExpired(): Promise<number> {
    const artifacts = await this.previews.pruneExpired();
    await Promise.allSettled(artifacts.map((id) => this.artifacts.deleteArtifact(id)));
    return artifacts.length;
  }
}

/** Runs queued previews from the PostgreSQL poll loop of a single-host deployment. */
export class DurablePreviewWorker implements OperationDispatcher {
  constructor(
    private readonly previews: ProfilePreviewStore,
    private readonly executor: OperationExecutor,
  ) {}
  async dispatch(): Promise<number> {
    const id = await this.previews.nextQueued();
    if (!id) return 0;
    await this.executor.execute(id);
    return 1;
  }
}
