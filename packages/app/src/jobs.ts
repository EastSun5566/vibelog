import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HackMdSource, buildFromVibelog, createAiProvider, createDevBuilder, isHackMdSourceError, renderThemeCss, validateThemeConfig } from '@vibelog/core';
import type { AiProvider, ContentSource } from '@vibelog/core';
import { parseSyncOperationPayload } from './blog-sync.js';
import type { AppConfig } from './config.js';
import type { AppDatabase, OperationRecord } from './database.js';
import { createReleaseSnapshot } from './publication-diff.js';
import { blogRoot } from './security/path.js';
import { reconcileStorage } from './storage.js';

const INTERRUPTED_OPERATION_MESSAGES: Record<OperationRecord['type'], string> = {
  sync: 'Sync was interrupted repeatedly. Your previous draft and live site are unchanged; please try again.',
  generate_theme: 'AI theme generation was interrupted repeatedly. Your previous theme is unchanged; please try again.',
  publish: 'Publishing was interrupted repeatedly. Your current live site is unchanged; please try again.',
};

function safeTechnicalError(error: unknown, config: AppConfig): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : 'Operation failed';
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password|invite)/i.test(name) ? [value] : []);
  return [config.dataRoot, ...secrets].reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
}
export function operationPublicError(type: OperationRecord['type'], error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (type === 'sync') {
    if (isHackMdSourceError(error)) {
      switch (error.code) {
      case 'profile_not_found': return 'We could not find that public HackMD user. Check the username and try again.';
      case 'article_not_found': return 'A public article disappeared during sync. Refresh HackMD and try again.';
      case 'rate_limited': return 'HackMD is temporarily limiting sync requests. Please try again later.';
      case 'temporarily_unavailable': case 'request_timeout': return 'HackMD is not responding reliably right now. Please try again later.';
      case 'request_rejected': return 'HackMD rejected the sync request. Confirm that your content is still public.';
      case 'invalid_response': return 'HackMD returned a response VibeLog could not read. Please try again later.';
      case 'metadata_too_large': return 'This HackMD profile exceeds the sync metadata limit. Reduce its public content and try again.';
      case 'too_many_articles': return 'VibeLog can sync up to 200 public articles at a time.';
      case 'article_too_large': return 'A HackMD article exceeds 2 MiB. Shorten it before syncing again.';
      case 'sync_too_large': return 'Public article text exceeds 32 MiB in total. Reduce the content before syncing again.';
      case 'no_public_articles': return 'This HackMD account does not have any public published articles.';
      case 'duplicate_slug': return 'Multiple articles would use the same URL. Update their HackMD permalinks first.';
      case 'invalid_published_date': return 'A HackMD article has an invalid published date. Fix it before syncing.';
      case 'invalid_modified_date': return 'A HackMD article has an invalid modified date. Fix it before syncing.';
      case 'invalid_slug': return 'A HackMD article cannot produce a valid URL. Add a title or permalink first.';
      }
    }
    if (message.includes('No articles selected')) return 'Select at least one article before building the blog draft.';
    return 'Sync failed. Confirm that your HackMD content is publicly readable and try again.';
  }
  if (type === 'generate_theme') return 'AI could not produce a valid theme. Your previous design is unchanged; adjust the prompt and try again.';
  return 'Publishing failed. Your draft and current live site are unchanged; please try again.';
}
function publicOrigin(config: AppConfig, username: string): string {
  const app = new URL(config.appOrigin);
  const host = `${username}.${app.hostname}${app.port ? `:${app.port}` : ''}`;
  return `${app.protocol}//${host}`;
}
async function removeReplacedDraft(root: string, previousDraft: string | null, nextDraft: string): Promise<void> {
  if (!previousDraft || resolve(previousDraft) === resolve(nextDraft)) return;
  const resolvedRoot = resolve(root);
  const resolvedPrevious = resolve(previousDraft);
  const pathFromDrafts = relative(resolve(root, 'drafts'), resolvedPrevious);
  const isLegacyDraft = resolvedPrevious === resolve(resolvedRoot, 'draft');
  const isVersionedDraft = Boolean(pathFromDrafts) && pathFromDrafts !== '..' && !pathFromDrafts.startsWith(`..${sep}`) && !isAbsolute(pathFromDrafts);
  if (!isLegacyDraft && !isVersionedDraft) return;
  await rm(previousDraft, { recursive: true, force: true });
}

export class OperationWorker {
  private stopped = false;
  constructor(
    private readonly database: AppDatabase,
    private readonly config: AppConfig,
    private readonly dependencies: {
      contentSource?: (username: string) => ContentSource;
      aiProvider?: () => AiProvider;
    } = {},
  ) {}

  async execute(operation: OperationRecord): Promise<Record<string, unknown>> {
    const blog = this.database.getBlog(operation.blogId);
    if (!blog || blog.userId !== operation.userId) throw new Error('Blog not found');
    const root = blogRoot(this.config.dataRoot, blog.userId, blog.id);
    switch (operation.type) {
    case 'sync': {
      const stagingRoot = join(root, `.sync-${randomUUID()}`);
      let installedDraft: string | null = null;
      try {
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 0, max: 4 }, 'Reading HackMD');
        await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        const source = this.dependencies.contentSource?.(blog.hackmdUsername) ?? new HackMdSource(blog.hackmdUsername);
        const [{ posts }, author] = await Promise.all([source.getPosts(), source.getAuthor()]);
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 1, max: 4 }, 'Preparing blog files');
        const payload = parseSyncOperationPayload(operation.payload);
        const site = payload.intent === 'identity'
          ? payload.site
          : { title: blog.title ?? `${author.name}'s blog`, description: blog.description ?? author.bio, language: blog.language };
        await writeFile(join(stagingRoot, 'vibelog.config.json'), JSON.stringify({ site }), { mode: 0o600 });
        const snapshotSource: ContentSource = {
          name: source.name,
          getPosts: () => Promise.resolve({ posts }),
          getAuthor: () => Promise.resolve(author),
        };
        const builder = createDevBuilder({ root: stagingRoot, contentSource: snapshotSource });
        await builder.prepare({ installDependencies: false });
        const excludedSlugs = payload.excludedSlugs
          ?? blog.contentManifest?.filter((post) => !post.included).map((post) => post.slug)
          ?? [];
        const summary = await builder.fetchContent({ excludedSlugs });
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 2, max: 4 }, 'Building static preview');
        const output = join(stagingRoot, 'dist');
        await buildFromVibelog({ vibelogDir: join(stagingRoot, '.vibelog'), outDir: output, site: publicOrigin(this.config, blog.username) });
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 3, max: 4 }, 'Finalizing draft');
        const draftsRoot = join(root, 'drafts');
        const draft = join(draftsRoot, randomUUID());
        await mkdir(draftsRoot, { recursive: true, mode: 0o700 });
        await rename(output, draft);
        installedDraft = draft;
        const message = payload.intent === 'identity'
          ? 'Blog details and content updated'
          : payload.intent === 'selection' ? 'Article selection and draft updated' : 'Content synced';
        this.database.completeSyncOperation(operation.id, {
          ...site,
          author: summary.author.name,
          draftArtifact: draft,
          contentManifest: summary.posts,
        }, { message });
        installedDraft = null;
        await removeReplacedDraft(root, blog.draftArtifact, draft).catch((error: unknown) => {
          console.error(`[operation:${operation.id}] failed to remove replaced draft: ${safeTechnicalError(error, this.config)}`);
        });
        return { message };
      } finally {
        if (installedDraft) await rm(installedDraft, { recursive: true, force: true });
        await rm(stagingRoot, { recursive: true, force: true });
      }
    }
    case 'generate_theme': {
      this.database.updateOperationProgress(operation.id, { kind: 'indeterminate' }, 'AI is designing a new theme…');
      const prompt = operation.payload.prompt;
      if (typeof prompt !== 'string') throw new Error('Theme description is required');
      const current = this.database.getActiveTheme(blog.id);
      if (!current) throw new Error('Active theme not found');
      let baseTheme = current.config;
      if (operation.payload.baseTheme) baseTheme = validateThemeConfig(operation.payload.baseTheme);
      const theme = await (this.dependencies.aiProvider?.() ?? createAiProvider(this.config.aiProvider, this.config.aiModel)).generate({
        blog: { title: blog.title ?? blog.username, description: blog.description ?? '', author: blog.author ?? blog.username }, currentTheme: baseTheme, prompt,
      });
      const revision = this.database.completeThemeOperation(operation.id, theme, { message: 'New theme ready' });
      return { message: 'New theme ready', revisionId: revision.id };
    }
    case 'publish': {
      if (!blog.draftArtifact) throw new Error('Sync content before publishing');
      const { contentVersion, themeRevisionId } = operation.payload;
      if (!Number.isInteger(contentVersion) || typeof themeRevisionId !== 'string') throw new Error('Publish snapshot is invalid');
      if (blog.contentVersion !== contentVersion) throw new Error('Draft changed before publishing');
      const theme = this.database.getTheme(themeRevisionId, blog.id);
      if (!theme) throw new Error('Active theme not found');
      const releasesRoot = join(root, 'releases');
      const releaseId = randomUUID();
      const staging = join(releasesRoot, `.staging-${releaseId}`);
      const release = join(releasesRoot, releaseId);
      await mkdir(releasesRoot, { recursive: true, mode: 0o700 });
      try {
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 0, max: 3 }, 'Copying draft');
        await cp(blog.draftArtifact, staging, { recursive: true, errorOnExist: true });
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 1, max: 3 }, 'Applying theme');
        await writeFile(join(staging, 'theme.css'), renderThemeCss(theme.config), { mode: 0o644 });
        await rename(staging, release);
        this.database.updateOperationProgress(operation.id, { kind: 'determinate', value: 2, max: 3 }, 'Activating release and cleaning up');
        const result = { message: 'Site published', url: publicOrigin(this.config, blog.username) };
        this.database.completePublishOperation(operation.id, release, createReleaseSnapshot(blog), result);
        try {
          this.database.prunePublishedReleases(blog.id);
          await reconcileStorage(this.config.dataRoot, this.database.listStorageReferences());
        } catch (error) {
          console.error(`[operation:${operation.id}] release cleanup will retry at startup: ${safeTechnicalError(error, this.config)}`);
        }
        return result;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        await rm(release, { recursive: true, force: true });
        throw error;
      }
    }
    }
  }

  async runOnce(): Promise<boolean> {
    const operation = this.database.claimNextOperation();
    if (!operation) return false;
    try { await this.execute(operation); }
    catch (error) {
      console.error(`[operation:${operation.id}] ${operation.type} failed: ${safeTechnicalError(error, this.config)}`);
      const message = operationPublicError(operation.type, error);
      this.database.failOperation(operation.id, message);
    }
    return true;
  }
  async run(pollMs = 500): Promise<void> {
    this.database.prunePublishedReleases();
    const storage = await reconcileStorage(this.config.dataRoot, this.database.listStorageReferences());
    const recovery = this.database.recoverOperations(INTERRUPTED_OPERATION_MESSAGES);
    console.log(`VibeLog worker ready: requeued=${String(recovery.requeued)} exhausted=${String(recovery.exhausted)} removed=${String(storage.removed)} warnings=${String(storage.warnings)}`);
    while (!this.stopped) if (!await this.runOnce()) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  stop(): void { this.stopped = true; }
}
