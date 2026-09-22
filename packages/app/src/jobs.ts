import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiProviderRequestError, AiProviderTimeoutError, HackMdSource, buildBlog, createAiProviderChain, createDevBuilder, isHackMdSourceError, validateBlogDesignSpec, writeSourceSnapshot } from '@vibelog/core';
import type { AiProvider, BlogDesignSpecV1, ContentSource } from '@vibelog/core';
import { parseSyncOperationPayload } from './blog-sync.js';
import type { OperationRuntimeConfig } from './config.js';
import type { AppDatabase, OperationRecord } from './database.js';
import { OperationLeaseLostError } from './database.js';
import type { ArtifactStore } from './ports/artifact-store.js';
import type { OperationDispatcher, OperationExecutor, OperationQueue, OperationResult } from './ports/operation-queue.js';
import { createReleaseSnapshot } from './publication-diff.js';

function safeTechnicalError(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : 'Operation failed';
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password|invite)/i.test(name) ? [value] : []);
  return secrets.reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
}
export function operationPublicError(type: OperationRecord['type'], error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (type === 'sync') {
    if (isHackMdSourceError(error)) {
      const messages: Partial<Record<typeof error.code, string>> = {
        profile_not_found: 'We could not find that public HackMD user. Check the username and try again.',
        article_not_found: 'A public article disappeared during sync. Refresh HackMD and try again.',
        rate_limited: 'HackMD is temporarily limiting sync requests. Please try again later.',
        temporarily_unavailable: 'HackMD is not responding reliably right now. Please try again later.',
        request_timeout: 'HackMD is not responding reliably right now. Please try again later.',
        no_public_articles: 'This HackMD account does not have any public published articles.',
      };
      const publicMessage = messages[error.code];
      if (publicMessage) return publicMessage;
    }
    if (message.includes('No articles selected')) return 'Select at least one article before building the blog draft.';
    return 'Sync failed. Confirm that your HackMD content is publicly readable and try again.';
  }
  if (type === 'generate_design') return error instanceof AiProviderTimeoutError
    ? 'AI took too long to respond. Your previous design is unchanged; please try again.'
    : error instanceof AiProviderRequestError
      ? 'AI service is temporarily unavailable. Your previous design is unchanged; try again shortly.'
      : 'AI could not produce a valid design. Your previous design is unchanged; adjust the prompt and try again.';
  if (type === 'apply_design' || type === 'activate_design') return 'The design could not be built. Your previous draft is unchanged; try again.';
  return 'Publishing failed. Your draft and current live site are unchanged; please try again.';
}
export class TerminalOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'TerminalOperationError'; }
}
export class RetryableOperationError extends Error {
  constructor(message: string, options?: ErrorOptions, readonly retryAfterSeconds = 5) { super(message, options); this.name = 'RetryableOperationError'; }
}
function publicOrigin(config: OperationRuntimeConfig, username: string): string {
  const app = new URL(config.appOrigin); return `${app.protocol}//${username}.${app.hostname}${app.port ? `:${app.port}` : ''}`;
}

export class AppOperationExecutor implements OperationExecutor {
  constructor(private readonly database: AppDatabase, private readonly artifacts: ArtifactStore, private readonly config: OperationRuntimeConfig, private readonly dependencies: { contentSource?: (username: string) => ContentSource; aiProvider?: () => AiProvider } = {}) {}
  async execute(operationId: string): Promise<OperationResult> {
    const operation = await this.database.claimOperation(operationId);
    if (!operation) {
      const current = await this.database.getOperation(operationId);
      if (!current || current.status === 'succeeded' || current.status === 'failed') return { duplicate: true };
      const retryAfter = current.leaseExpiresAt ? Math.max(5, Math.ceil((Date.parse(current.leaseExpiresAt) - Date.now()) / 1000)) : 5;
      throw new RetryableOperationError('Operation is still in progress', undefined, retryAfter);
    }
    try { return await this.executeClaimed(operation); }
    catch (error) {
      if (error instanceof OperationLeaseLostError) throw new RetryableOperationError(error.message, { cause: error });
      console.error(`[operation:${operation.id}] ${operation.type} failed: ${safeTechnicalError(error)}`);
      const publicError = operationPublicError(operation.type, error);
      try { await this.database.failOperation(operation, publicError); }
      catch (persistenceError) { throw new RetryableOperationError('Could not persist operation failure', { cause: persistenceError }); }
      throw new TerminalOperationError(publicError, { cause: error });
    }
  }
  private async executeClaimed(operation: OperationRecord): Promise<OperationResult> {
    const blog = await this.database.getBlog(operation.blogId);
    if (!blog || blog.userId !== operation.userId) throw new Error('Blog not found');
    if (operation.type === 'sync') {
      const work = await mkdtemp(join(tmpdir(), 'vibelog-sync-'));
      const sourceArtifact = await this.database.createArtifact(blog.id, 'source');
      const draftArtifact = await this.database.createArtifact(blog.id, 'draft');
      try {
        await this.database.updateOperationProgress(operation, { kind: 'determinate', value: 0, max: 4 }, 'Reading HackMD');
        const source = this.dependencies.contentSource?.(blog.hackmdUsername) ?? new HackMdSource(blog.hackmdUsername, { baseUrl: this.config.hackmdBaseUrl });
        const [{ posts }, author] = await Promise.all([source.getPosts(), source.getAuthor()]);
        const payload = parseSyncOperationPayload(operation.payload);
        const site = payload.intent === 'identity' ? payload.site : { title: blog.title ?? `${author.name}'s blog`, description: blog.description ?? author.bio, language: blog.language };
        await writeFile(join(work, 'vibelog.config.json'), JSON.stringify({ site }), { mode: 0o600 });
        const snapshotSource: ContentSource = { name: source.name, getPosts: () => Promise.resolve({ posts }), getAuthor: () => Promise.resolve(author) };
        const builder = createDevBuilder({ root: work, contentSource: snapshotSource }); await builder.prepare({ installDependencies: false });
        const excludedSlugs = payload.excludedSlugs ?? blog.contentManifest?.filter((post) => !post.included).map((post) => post.slug) ?? [];
        const summary = await builder.fetchContent({ excludedSlugs });
        const activeDesign = await this.database.getActiveDesign(blog.id); if (!activeDesign) throw new Error('Active design not found');
        await this.database.updateOperationProgress(operation, { kind: 'determinate', value: 2, max: 4 }, 'Building static preview');
        const sourceDirectory = join(work, 'source');
        await writeSourceSnapshot(builder.vibelogDir, sourceDirectory, summary);
        await this.artifacts.uploadDirectory(sourceArtifact.id, sourceDirectory);
        const compileRoot = join(work, 'compile'); const output = join(compileRoot, 'dist');
        await buildBlog({ sourceDir: sourceDirectory, design: activeDesign.config, workDir: compileRoot, outDir: output, site: publicOrigin(this.config, blog.username) });
        await this.artifacts.uploadDirectory(draftArtifact.id, output);
        const message = payload.intent === 'identity' ? 'Blog details and content updated' : payload.intent === 'selection' ? 'Article selection and draft updated' : 'Content synced';
        await this.database.completeSyncOperation(operation, { ...site, author: summary.author.name, sourceArtifactId: sourceArtifact.id, draftArtifactId: draftArtifact.id, designRevisionId: activeDesign.id, contentProfile: summary.contentProfile, contentManifest: summary.posts }, { message });
        return { message };
      } catch (error) { await Promise.all([this.database.markArtifactCleanup(sourceArtifact.id), this.database.markArtifactCleanup(draftArtifact.id)]); throw error; }
      finally { await rm(work, { recursive: true, force: true }); }
    }
    if (operation.type === 'generate_design' || operation.type === 'apply_design' || operation.type === 'activate_design') {
      if (!blog.sourceArtifactId || !blog.contentProfile) throw new Error('Sync the content before changing the design');
      const sourceArtifactId = operation.payload.sourceArtifactId;
      if (sourceArtifactId !== blog.sourceArtifactId) throw new Error('Source changed before design build');
      let design: BlogDesignSpecV1;
      if (operation.type === 'generate_design') {
        await this.database.updateOperationProgress(operation, { kind: 'indeterminate' }, 'AI is designing a new presentation…');
        const prompt = operation.payload.prompt; if (typeof prompt !== 'string') throw new Error('Design description is required');
        const current = await this.database.getActiveDesign(blog.id); if (!current) throw new Error('Active design not found');
        const baseDesign = operation.payload.baseDesign ? validateBlogDesignSpec(operation.payload.baseDesign) : current.config;
        design = await (this.dependencies.aiProvider?.() ?? createAiProviderChain(this.config.aiProvider, this.config.aiModel, this.config.aiFallbackModels)).generate({ blog: { title: blog.title ?? blog.username, description: blog.description ?? '', author: blog.author ?? blog.username }, contentProfile: blog.contentProfile, currentDesign: baseDesign, prompt }, { sessionId: operation.id });
      } else if (operation.type === 'apply_design') {
        design = validateBlogDesignSpec(operation.payload.design);
      } else {
        const revisionId = operation.payload.designRevisionId; if (typeof revisionId !== 'string') throw new Error('Design revision is required');
        const revision = await this.database.getDesignRevision(revisionId, blog.id); if (!revision) throw new Error('Design revision not found');
        design = revision.config;
      }
      const work = await mkdtemp(join(tmpdir(), 'vibelog-design-')); const artifact = await this.database.createArtifact(blog.id, 'draft');
      try {
        await this.database.updateOperationProgress(operation, { kind: 'determinate', value: 1, max: 3 }, 'Building design preview');
        const sourceDirectory = join(work, 'source'); await this.artifacts.materializeArtifact(blog.sourceArtifactId, sourceDirectory);
        const compileRoot = join(work, 'compile'); const output = join(compileRoot, 'dist');
        await buildBlog({ sourceDir: sourceDirectory, design, workDir: compileRoot, outDir: output, site: publicOrigin(this.config, blog.username) });
        await this.artifacts.uploadDirectory(artifact.id, output);
        const revision = await this.database.completeDesignOperation(operation, design, artifact.id, { message: 'New design ready' });
        return { message: 'New design ready', revisionId: revision.id };
      } catch (error) { await this.database.markArtifactCleanup(artifact.id); throw error; }
      finally { await rm(work, { recursive: true, force: true }); }
    }
    if (!blog.draftArtifactId) throw new Error('Sync content before publishing');
    const contentVersion = operation.payload.contentVersion; const designRevisionId = operation.payload.designRevisionId; const draftArtifactId = operation.payload.draftArtifactId;
    if (!Number.isInteger(contentVersion) || typeof designRevisionId !== 'string' || typeof draftArtifactId !== 'string' || blog.contentVersion !== contentVersion || blog.draftArtifactId !== draftArtifactId || blog.draftDesignRevisionId !== designRevisionId) throw new Error('Publish snapshot is invalid');
    const artifact = await this.database.createArtifact(blog.id, 'release');
    try {
      await this.database.updateOperationProgress(operation, { kind: 'determinate', value: 0, max: 3 }, 'Copying draft');
      await this.artifacts.copyArtifact(draftArtifactId, artifact.id);
      const result = { message: 'Site published', url: publicOrigin(this.config, blog.username) };
      await this.database.completePublishOperation(operation, artifact.id, createReleaseSnapshot(blog), result);
      return result;
    } catch (error) { await this.database.markArtifactCleanup(artifact.id); throw error; }
  }
  async cleanupArtifact(id: string): Promise<void> { await this.artifacts.deleteArtifact(id); await this.database.deleteArtifactRecord(id); }
  async cleanupPending(): Promise<number> {
    const releases = await this.database.prunePublishedReleases();
    const pending = await this.database.listCleanupArtifacts();
    for (const item of pending) await this.cleanupArtifact(item.id);
    const transient = await this.database.pruneTransientData();
    console.info(JSON.stringify({ event: 'maintenance_cleanup', releases: releases.length, artifacts: pending.length, ...transient }));
    return pending.length;
  }
}
export class OutboxDispatcher implements OperationDispatcher {
  constructor(private readonly database: AppDatabase, private readonly queue: OperationQueue) {}
  async dispatch(limit = 100): Promise<number> {
    await this.database.recoverExpiredOperations(limit);
    const events = await this.database.listPendingOutbox(limit); let sent = 0;
    for (const event of events) {
      try { await this.queue.enqueue(event.message); await this.database.markOutboxDispatched(event.id, event.message.traceId); sent += 1; }
      catch (error) { await this.database.noteOutboxAttempt(event.id); throw error; }
    }
    return sent;
  }
}

export class DeferredOutboxDispatcher implements OperationDispatcher {
  dispatch(): Promise<number> { return Promise.resolve(0); }
}

type DurableOutboxDatabase = Pick<AppDatabase, 'getOperation' | 'listPendingOutbox' | 'markOutboxDispatched' | 'noteOutboxAttempt'>;

/** Executes the transactional outbox directly for a single-host deployment. */
export class DurableOutboxWorker implements OperationDispatcher {
  constructor(private readonly database: DurableOutboxDatabase, private readonly executor: OperationExecutor) {}
  async dispatch(limit = 1): Promise<number> {
    const events = await this.database.listPendingOutbox(limit); let completed = 0;
    for (const event of events) {
      try { await this.executor.execute(event.operationId); }
      catch (error) {
        if (!(error instanceof TerminalOperationError)) { await this.database.noteOutboxAttempt(event.id); throw error; }
      }
      const operation = await this.database.getOperation(event.operationId);
      if (operation?.status === 'succeeded' || operation?.status === 'failed') {
        await this.database.markOutboxDispatched(event.id, event.message.traceId); completed += 1;
      }
    }
    return completed;
  }
}
