import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_DESIGN_V2,
  HackMdSource,
  buildBlog,
  createAiProviderChain,
  createDevBuilder,
  createPostSamples,
  searchIndexIdentity,
  structuralBuildIdentity,
  validateBlogDesignSpecV2,
  writeSourceSnapshot,
} from '@vibelog/core';
import type { AiProvider, BlogDesignSpecV2, ContentSource, Post } from '@vibelog/core';
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

/** The request an anonymous preview sends to the designer instead of a writer's words. */
export const PREVIEW_DESIGN_PROMPT =
  'Design this blog for its writer. Read the samples, their recent post titles, tags and excerpts, and propose a complete design whose motif, colors, typography and layout fit what they write about and how they write it.';

/**
 * Builds the anonymous preview for one HackMD profile. Every failure is terminal for the job:
 * the visitor sees the message, and a later visit may try again.
 */
export class ProfilePreviewExecutor implements OperationExecutor {
  constructor(
    private readonly previews: ProfilePreviewStore,
    private readonly artifacts: ArtifactStore,
    private readonly config: Pick<
      OperationRuntimeConfig,
      | 'appOrigin'
      | 'hackmdBaseUrl'
      | 'aiProvider'
      | 'aiModel'
      | 'aiFallbackModels'
      | 'previewAiDailyLimit'
    >,
    private readonly dependencies: {
      contentSource?: (username: string) => ContentSource;
      aiProvider?: () => AiProvider;
    } = {},
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
    const { design, designSource } = await this.chooseDesign(
      lease,
      site,
      author.name,
      posts,
      summary.contentProfile,
    );
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
      designSource,
      title: site.title,
      author: summary.author.name,
      contentProfile: summary.contentProfile,
    };
  }

  /**
   * Asks the AI for a design that fits the posts, within the previews' daily budget. Any
   * failure keeps the starter preset, so a preview never fails because of the designer.
   */
  private async chooseDesign(
    lease: ProfilePreviewRecord,
    site: { title: string; description: string },
    author: string,
    posts: Post[],
    contentProfile: Parameters<typeof pickPreset>[0],
  ): Promise<{ design: BlogDesignSpecV2; designSource: 'preset' | 'ai' }> {
    const preset = applyDesignPreset(DEFAULT_DESIGN_V2, pickPreset(contentProfile));
    if (!(await this.previews.consumeAiBudget(this.config.previewAiDailyLimit)))
      return { design: preset, designSource: 'preset' };
    await this.previews.setStage(lease, 'Designing to match your posts');
    try {
      const provider =
        this.dependencies.aiProvider?.() ??
        createAiProviderChain(
          this.config.aiProvider,
          this.config.aiModel,
          this.config.aiFallbackModels,
        );
      const design = await provider.generate(
        {
          blog: { title: site.title, description: site.description, author },
          contentProfile,
          currentDesign: preset,
          prompt: PREVIEW_DESIGN_PROMPT,
          samples: createPostSamples(posts),
        },
        { sessionId: lease.id },
      );
      return { design: validateBlogDesignSpecV2(design), designSource: 'ai' };
    } catch (error) {
      console.warn(
        `[preview:${lease.id}] AI design failed; using the starter preset: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { design: preset, designSource: 'preset' };
    }
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
