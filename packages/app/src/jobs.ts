import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HackMdSource, buildFromVibelog, createAiProvider, createDevBuilder, renderThemeCss } from '@vibelog/core';
import type { AiProvider, ContentSource } from '@vibelog/core';
import type { AppConfig } from './config.js';
import type { AppDatabase, OperationRecord } from './database.js';
import { blogRoot } from './security/path.js';

function safeTechnicalError(error: unknown, config: AppConfig): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : 'Operation failed';
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password|invite)/i.test(name) ? [value] : []);
  return [config.dataRoot, ...secrets].reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
}
function publicError(type: OperationRecord['type'], error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (type === 'sync') {
    if (/Failed to fetch HackMD (?:profile|content): Not Found/.test(message)) return '找不到這個公開 HackMD 使用者，請確認 username 後再試一次。';
    if (message.includes('No public published HackMD articles')) return '這個 HackMD 帳號目前沒有公開發布的文章。';
    if (message.includes('Duplicate') && message.includes('slug')) return '有多篇文章會產生相同網址，請先調整 HackMD 文章的 permalink。';
    if (message.includes('invalid published date')) return '有 HackMD 文章的發布日期無效，請修正後再同步。';
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
      try {
        await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        const source = this.dependencies.contentSource?.(blog.hackmdUsername) ?? new HackMdSource(blog.hackmdUsername);
        const author = await source.getAuthor();
        await writeFile(join(stagingRoot, 'vibelog.config.json'), JSON.stringify({ site: { title: `${author.name}'s blog`, description: author.bio, language: 'zh-Hant' } }), { mode: 0o600 });
        const builder = createDevBuilder({ root: stagingRoot, contentSource: source });
        await builder.prepare({ installDependencies: false });
        await builder.fetchContent();
        const output = join(stagingRoot, 'dist');
        await buildFromVibelog({ vibelogDir: join(stagingRoot, '.vibelog'), outDir: output, site: publicOrigin(this.config, blog.username) });
        const draft = join(root, 'draft');
        const backup = join(root, `.draft-backup-${randomUUID()}`);
        await mkdir(root, { recursive: true, mode: 0o700 });
        let backedUp = false;
        try {
          await rename(draft, backup); backedUp = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try { await rename(output, draft); if (backedUp) await rm(backup, { recursive: true, force: true }); }
        catch (error) { if (backedUp) await rename(backup, draft); throw error; }
        this.database.completeSync(blog.id, { title: `${author.name}'s blog`, description: author.bio, author: author.name, draftArtifact: draft });
        return { message: '內容已同步' };
      } finally { await rm(stagingRoot, { recursive: true, force: true }); }
    }
    case 'generate_theme': {
      const prompt = operation.payload.prompt;
      if (typeof prompt !== 'string') throw new Error('Theme description is required');
      const current = this.database.getActiveTheme(blog.id);
      if (!current) throw new Error('Active theme not found');
      const theme = await (this.dependencies.aiProvider?.() ?? createAiProvider(this.config.aiProvider, this.config.aiModel)).generate({
        blog: { title: blog.title ?? blog.username, description: blog.description ?? '', author: blog.author ?? blog.username }, currentTheme: current.config, prompt,
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
        this.database.activateRelease(blog.id, theme.id, contentVersion, release);
        return { message: '網站已發布', url: publicOrigin(this.config, blog.username) };
      } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
    }
    }
  }

  async runOnce(): Promise<boolean> {
    const operation = this.database.claimNextOperation();
    if (!operation) return false;
    try { this.database.completeOperation(operation.id, await this.execute(operation)); }
    catch (error) {
      console.error(`[operation:${operation.id}] ${operation.type} failed: ${safeTechnicalError(error, this.config)}`);
      const message = publicError(operation.type, error);
      this.database.failOperation(operation.id, message);
      if (operation.type === 'sync') this.database.failSync(operation.blogId, message);
    }
    return true;
  }
  async run(pollMs = 500): Promise<void> { this.database.recoverOperations(); while (!this.stopped) if (!await this.runOnce()) await new Promise((resolve) => setTimeout(resolve, pollMs)); }
  stop(): void { this.stopped = true; }
}
