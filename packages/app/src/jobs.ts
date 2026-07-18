import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HackMdSource, buildFromVibelog, createAiProvider, createDevBuilder, renderThemeCss } from '@vibelog/core';
import type { AiProvider, ContentSource } from '@vibelog/core';
import type { AppConfig } from './config.js';
import type { AppDatabase, OperationRecord } from './database.js';
import { blogRoot } from './security/path.js';

function publicError(error: unknown, config: AppConfig): string {
  const message = error instanceof Error ? error.message : 'Operation failed';
  const secrets = Object.entries(process.env).flatMap(([name, value]) => value && value.length >= 8 && /(?:token|secret|api.?key|password|invite)/i.test(name) ? [value] : []);
  return [config.dataRoot, ...secrets].reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), message).replaceAll(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]').slice(0, 500);
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
      const theme = this.database.getActiveTheme(blog.id);
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
        this.database.activateRelease(blog.id, theme.id, release);
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
      const message = publicError(error, this.config);
      this.database.failOperation(operation.id, message);
      if (operation.type === 'sync') this.database.failSync(operation.blogId, message);
    }
    return true;
  }
  async run(pollMs = 500): Promise<void> { this.database.recoverOperations(); while (!this.stopped) if (!await this.runOnce()) await new Promise((resolve) => setTimeout(resolve, pollMs)); }
  stop(): void { this.stopped = true; }
}
