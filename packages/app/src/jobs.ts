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
      case 'profile_not_found': return '找不到這個公開 HackMD 使用者，請確認 username 後再試一次。';
      case 'article_not_found': return '同步期間有公開文章消失或無法讀取，請重新整理 HackMD 後再試一次。';
      case 'rate_limited': return 'HackMD 暫時限制同步請求，請稍後再試一次。';
      case 'temporarily_unavailable': case 'request_timeout': return 'HackMD 暫時無法穩定回應，請稍後再試一次。';
      case 'request_rejected': return 'HackMD 拒絕了同步請求，請確認內容仍為公開狀態。';
      case 'invalid_response': return 'HackMD 回應格式暫時無法辨識，請稍後再試一次。';
      case 'metadata_too_large': return 'HackMD 帳號資料超過同步上限，請減少公開內容後再試一次。';
      case 'too_many_articles': return 'VibeLog 一次最多同步 200 篇公開文章。';
      case 'article_too_large': return '有 HackMD 文章超過 2 MiB，請縮短內容後再同步。';
      case 'sync_too_large': return '公開文章內容合計超過 32 MiB，請減少內容後再同步。';
      case 'no_public_articles': return '這個 HackMD 帳號目前沒有公開發布的文章。';
      case 'duplicate_slug': return '有多篇文章會產生相同網址，請先調整 HackMD 文章的 permalink。';
      case 'invalid_published_date': return '有 HackMD 文章的發布日期無效，請修正後再同步。';
      case 'invalid_modified_date': return '有 HackMD 文章的最後修改日期無效，請修正後再同步。';
      case 'invalid_slug': return '有 HackMD 文章無法產生有效網址，請補上標題或 permalink。';
      }
    }
    if (message.includes('No articles selected')) return '至少要選取一篇文章，才能建立 Blog 草稿。';
    return '同步失敗，請確認 HackMD 內容可以公開讀取後再試一次。';
  }
  if (type === 'generate_theme') return 'AI 暫時無法產生可用樣式，原本的設計沒有變更，請調整描述後再試一次。';
  return '發布失敗，草稿與目前的線上版本都沒有變更，請再試一次。';
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
        await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        const source = this.dependencies.contentSource?.(blog.hackmdUsername) ?? new HackMdSource(blog.hackmdUsername);
        const [{ posts }, author] = await Promise.all([source.getPosts(), source.getAuthor()]);
        const payload = parseSyncOperationPayload(operation.payload);
        const site = payload.intent === 'identity'
          ? payload.site
          : { title: blog.title ?? `${author.name}'s blog`, description: blog.description ?? author.bio };
        await writeFile(join(stagingRoot, 'vibelog.config.json'), JSON.stringify({ site: { ...site, language: 'zh-Hant' } }), { mode: 0o600 });
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
        const output = join(stagingRoot, 'dist');
        await buildFromVibelog({ vibelogDir: join(stagingRoot, '.vibelog'), outDir: output, site: publicOrigin(this.config, blog.username) });
        const draftsRoot = join(root, 'drafts');
        const draft = join(draftsRoot, randomUUID());
        await mkdir(draftsRoot, { recursive: true, mode: 0o700 });
        await rename(output, draft);
        installedDraft = draft;
        this.database.completeSync(blog.id, {
          ...site,
          author: summary.author.name,
          draftArtifact: draft,
          contentManifest: summary.posts,
        });
        installedDraft = null;
        await removeReplacedDraft(root, blog.draftArtifact, draft).catch((error: unknown) => {
          console.error(`[operation:${operation.id}] failed to remove replaced draft: ${safeTechnicalError(error, this.config)}`);
        });
        const message = payload.intent === 'identity'
          ? 'Blog 資訊與內容已更新'
          : payload.intent === 'selection' ? '文章選擇與草稿已更新' : '內容已同步';
        return { message };
      } finally {
        if (installedDraft) await rm(installedDraft, { recursive: true, force: true });
        await rm(stagingRoot, { recursive: true, force: true });
      }
    }
    case 'generate_theme': {
      const prompt = operation.payload.prompt;
      if (typeof prompt !== 'string') throw new Error('Theme description is required');
      const current = this.database.getActiveTheme(blog.id);
      if (!current) throw new Error('Active theme not found');
      let baseTheme = current.config;
      if (operation.payload.baseTheme) baseTheme = validateThemeConfig(operation.payload.baseTheme);
      const theme = await (this.dependencies.aiProvider?.() ?? createAiProvider(this.config.aiProvider, this.config.aiModel)).generate({
        blog: { title: blog.title ?? blog.username, description: blog.description ?? '', author: blog.author ?? blog.username }, currentTheme: baseTheme, prompt,
      });
      const revision = this.database.createTheme(blog.id, theme, prompt);
      return { message: '新樣式已準備好', revisionId: revision.id };
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
        await cp(blog.draftArtifact, staging, { recursive: true, errorOnExist: true });
        await writeFile(join(staging, 'theme.css'), renderThemeCss(theme.config), { mode: 0o644 });
        await rename(staging, release);
        this.database.activateRelease(blog.id, theme.id, contentVersion, release, createReleaseSnapshot(blog));
        return { message: '網站已發布', url: publicOrigin(this.config, blog.username) };
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
    try { this.database.completeOperation(operation.id, await this.execute(operation)); }
    catch (error) {
      console.error(`[operation:${operation.id}] ${operation.type} failed: ${safeTechnicalError(error, this.config)}`);
      const message = operationPublicError(operation.type, error);
      this.database.failOperation(operation.id, message);
      if (operation.type === 'sync') this.database.failSync(operation.blogId, message);
    }
    return true;
  }
  async run(pollMs = 500): Promise<void> { this.database.recoverOperations(); while (!this.stopped) if (!await this.runOnce()) await new Promise((resolve) => setTimeout(resolve, pollMs)); }
  stop(): void { this.stopped = true; }
}
