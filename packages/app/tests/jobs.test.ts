import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentSourceName, DEFAULT_THEME, HackMdSourceError } from '@vibelog/core';
import type { AiProvider, ContentSource, ThemeConfig } from '@vibelog/core';
import type { AppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { OperationWorker, operationPublicError } from '../src/jobs.js';
import { user } from '../src/schema.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('OperationWorker publication snapshots', () => {
  it('reads the source once, preserves custom identity, and switches immutable drafts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-sync-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: '10101010-1010-4010-8010-101010101010', name: 'sync', email: 'sync@users.vibelog.invalid', emailVerified: false, username: 'sync', displayUsername: 'sync', createdAt: date, updatedAt: date }).run();
    const { blog, operation: initial } = database.createBlog('10101010-1010-4010-8010-101010101010', 'sync', 'sync'); database.completeOperation(initial.id);
    const oldDraft = join(root, 'blogs', blog.userId, blog.id, 'draft'); await mkdir(oldDraft, { recursive: true }); await writeFile(join(oldDraft, 'index.html'), '<h1>Old</h1>');
    database.completeSync(blog.id, {
      title: 'Custom title', description: 'Custom description', author: 'Old Writer', draftArtifact: oldDraft,
      contentManifest: [{ title: 'Older', slug: 'older', publishedAt: '2026-01-01T00:00:00.000Z', included: false }],
    });
    const operation = database.createSyncOperation(blog.userId, blog.id, { intent: 'content' });
    const getAuthor = vi.fn(() => Promise.resolve({ name: 'Writer', bio: 'Updated bio' }));
    const getPosts = vi.fn(() => Promise.resolve({ posts: [
      { id: 'older', title: 'Older', slug: 'older', date: '2026-01-01T00:00:00.000Z', content: 'Older article' },
      { id: 'newer', title: 'Newer', slug: 'newer', date: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-03T12:00:00.000Z', tags: ['Writing'], content: 'Newer article' },
    ] }));
    const source: ContentSource = { name: ContentSourceName.HACKMD, getAuthor, getPosts };
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;

    await new OperationWorker(database, config, { contentSource: () => source }).execute(operation);

    const synced = database.getBlog(blog.id); if (!synced?.draftArtifact) throw new Error('Draft missing');
    expect(getAuthor).toHaveBeenCalledOnce(); expect(getPosts).toHaveBeenCalledOnce();
    expect(synced).toMatchObject({
      title: 'Custom title', description: 'Custom description', author: 'Writer', contentVersion: 2,
      contentManifest: [
        { title: 'Newer', slug: 'newer', publishedAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-03T12:00:00.000Z', included: true, tags: [{ name: 'Writing', slug: 'writing' }] },
        { title: 'Older', slug: 'older', publishedAt: '2026-01-01T00:00:00.000Z', included: false, tags: [] },
      ],
    });
    expect(synced.draftArtifact).toMatch(/\/drafts\/[0-9a-f-]+$/);
    expect(await readFile(join(synced.draftArtifact, 'index.html'), 'utf8')).toContain('Custom title');
    await expect(readFile(join(synced.draftArtifact, 'blog', 'older', 'index.html'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(synced.draftArtifact, 'blog', 'newer', 'index.html'), 'utf8')).toContain('Newer');
    await expect(readFile(join(oldDraft, 'index.html'), 'utf8')).rejects.toThrow();
    database.close();
  }, 30_000);

  it('keeps the previous draft and metadata when the database switch fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-sync-failure-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: '20202020-2020-4020-8020-202020202020', name: 'failure', email: 'failure@users.vibelog.invalid', emailVerified: false, username: 'failure', displayUsername: 'failure', createdAt: date, updatedAt: date }).run();
    const { blog, operation: initial } = database.createBlog('20202020-2020-4020-8020-202020202020', 'failure', 'failure'); database.completeOperation(initial.id);
    const oldDraft = join(root, 'blogs', blog.userId, blog.id, 'draft'); await mkdir(oldDraft, { recursive: true }); await writeFile(join(oldDraft, 'index.html'), '<h1>Still current</h1>');
    database.completeSync(blog.id, { title: 'Current', description: 'Current description', author: 'Writer', draftArtifact: oldDraft, contentManifest: [{ title: 'Current post', slug: 'current', publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', included: true, tags: [{ name: 'Existing', slug: 'existing' }] }] });
    const operation = database.createSyncOperation(blog.userId, blog.id, { intent: 'identity', site: { title: 'Attempted', description: 'Attempted description' } });
    const source: ContentSource = { name: ContentSourceName.HACKMD, getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Bio' }), getPosts: () => Promise.resolve({ posts: [{ id: 'post', title: 'Post', slug: 'post', date: '2026-02-01T00:00:00.000Z', content: 'Body' }] }) };
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;
    const completeSync = vi.spyOn(database, 'completeSync').mockImplementationOnce(() => { throw new Error('database switch failed'); });

    await expect(new OperationWorker(database, config, { contentSource: () => source }).execute(operation)).rejects.toThrow('database switch failed');

    expect(database.getBlog(blog.id)).toMatchObject({ title: 'Current', description: 'Current description', draftArtifact: oldDraft, contentVersion: 1, contentManifest: [{ title: 'Current post', slug: 'current', publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', included: true, tags: [{ name: 'Existing', slug: 'existing' }] }] });
    expect(await readFile(join(oldDraft, 'index.html'), 'utf8')).toContain('Still current');
    expect(await readdir(join(root, 'blogs', blog.userId, blog.id, 'drafts')).catch(() => [])).toHaveLength(0);
    completeSync.mockRestore(); database.close();
  }, 30_000);

  it('keeps the previous draft and release when HackMD is temporarily unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-source-failure-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    const userId = '30303030-3030-4030-8030-303030303030';
    database.db.insert(user).values({ id: userId, name: 'source', email: 'source@users.vibelog.invalid', emailVerified: false, username: 'source', displayUsername: 'source', createdAt: date, updatedAt: date }).run();
    const { blog, operation: initial } = database.createBlog(userId, 'source', 'source'); database.completeOperation(initial.id);
    const oldDraft = join(root, 'old-draft'); await mkdir(oldDraft); await writeFile(join(oldDraft, 'index.html'), '<h1>Still current</h1>');
    database.completeSync(blog.id, { title: 'Current', description: 'Current description', author: 'Writer', draftArtifact: oldDraft, contentManifest: [{ title: 'Current post', slug: 'current', publishedAt: '2026-01-01T00:00:00.000Z', included: true }] });
    const theme = database.getActiveTheme(blog.id); if (!theme) throw new Error('Theme missing');
    database.createPreviewSession('source-preview', userId, blog.id, '2099-01-01T00:00:00.000Z', theme.config);
    const publish = database.createPublishOperation(userId, blog.id, 'source-preview');
    await new OperationWorker(database, { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig).execute(publish);
    database.completeOperation(publish.id);
    const release = database.getActiveRelease(blog.id); if (!release) throw new Error('Release missing');
    const sync = database.createSyncOperation(userId, blog.id, { intent: 'content' });
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Bio' }),
      getPosts: () => Promise.reject(new HackMdSourceError('rate_limited', 'HackMD rate limit exceeded')),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new OperationWorker(database, { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig, { contentSource: () => source }).runOnce();

    expect(database.getBlog(blog.id)).toMatchObject({
      title: 'Current', description: 'Current description', author: 'Writer', draftArtifact: oldDraft, contentVersion: 1,
      contentManifest: [{ title: 'Current post', slug: 'current', publishedAt: '2026-01-01T00:00:00.000Z', included: true }],
    });
    expect(database.getActiveRelease(blog.id)?.id).toBe(release.id);
    expect(database.getOperation(sync.id, userId)).toMatchObject({ status: 'failed', errorMessage: 'HackMD 暫時限制同步請求，請稍後再試一次。' });
    expect(await readFile(join(oldDraft, 'index.html'), 'utf8')).toContain('Still current');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Current post');
    database.close();
  });

  it('uses the preview theme captured when AI work was enqueued', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-ai-base-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'theme', email: 'theme@users.vibelog.invalid', emailVerified: false, username: 'theme', displayUsername: 'theme', createdAt: date, updatedAt: date }).run();
    const { blog, operation } = database.createBlog('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'theme', 'theme'); database.completeOperation(operation.id);
    const baseTheme: ThemeConfig = { ...DEFAULT_THEME, preset: 'editorial', contentWidth: 'wide', description: 'Current preview' };
    const generate = database.createThemeOperation(blog.userId, blog.id, 'keep this direction', baseTheme, { userDailyLimit: 20, globalDailyLimit: 200 });
    let received: ThemeConfig | undefined;
    const provider: AiProvider = { name: 'faux', modelId: 'faux', generate(input) { received = input.currentTheme; return Promise.resolve({ ...input.currentTheme, radius: 'round', description: 'AI continuation' }); } };
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;
    await new OperationWorker(database, config, { aiProvider: () => provider }).execute(generate);
    expect(received).toEqual(baseTheme);
    expect(database.getActiveTheme(blog.id)).toMatchObject({ source: 'ai', config: { preset: 'editorial', contentWidth: 'wide', radius: 'round' } });
    database.close();
  });

  it('publishes the content and theme selected when work was enqueued', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-publish-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: '88888888-8888-4888-8888-888888888888', name: 'frank', email: 'frank@users.vibelog.invalid', emailVerified: false, username: 'frank', displayUsername: 'frank', createdAt: date, updatedAt: date }).run();
    const { blog, operation } = database.createBlog('88888888-8888-4888-8888-888888888888', 'frank', 'frank'); database.completeOperation(operation.id);
    const draft = join(root, 'draft'); await mkdir(draft); await writeFile(join(draft, 'index.html'), '<h1>Draft</h1>');
    const digest = createHash('sha256').update('Published body').digest('hex');
    database.completeSync(blog.id, { title: 'Frank', description: '', author: 'Frank', draftArtifact: draft, contentManifest: [
      { title: 'Published post', slug: 'published-post', publishedAt: '2026-01-01T00:00:00.000Z', included: true, tags: [], contentHash: digest },
    ] });
    const selectedTheme = database.getActiveTheme(blog.id); if (!selectedTheme) throw new Error('Theme missing');
    database.createPreviewSession('frank-preview', blog.userId, blog.id, '2099-01-01T00:00:00.000Z', selectedTheme.config);
    const publish = database.createPublishOperation(blog.userId, blog.id, 'frank-preview');
    database.createTheme(blog.id, { ...DEFAULT_THEME, appearance: 'dark', colors: { ...DEFAULT_THEME.colors, background: '#111111', surface: '#222222', text: '#ffffff', muted: '#c0c0c0', accent: '#80caff', border: '#555555' }, description: 'A later theme' }, 'later change');
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;
    await new OperationWorker(database, config).execute(publish);
    const release = database.getActiveRelease(blog.id);
    expect(release).toMatchObject({
      themeRevisionId: selectedTheme.id,
      contentVersion: 1,
      snapshot: {
        site: { title: 'Frank', description: '', author: 'Frank' },
        posts: [{ slug: 'published-post', contentHash: digest }],
      },
    });
    database.close();
  });

  it('refuses to publish if the draft changed after enqueue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-stale-publish-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: '99999999-9999-4999-8999-999999999999', name: 'grace', email: 'grace@users.vibelog.invalid', emailVerified: false, username: 'grace', displayUsername: 'grace', createdAt: date, updatedAt: date }).run();
    const { blog, operation } = database.createBlog('99999999-9999-4999-8999-999999999999', 'grace', 'grace'); database.completeOperation(operation.id);
    const draft = join(root, 'draft'); await mkdir(draft); await writeFile(join(draft, 'index.html'), '<h1>Draft</h1>');
    database.completeSync(blog.id, { title: 'Grace', description: '', author: 'Grace', draftArtifact: draft });
    const theme = database.getActiveTheme(blog.id); if (!theme) throw new Error('Theme missing');
    database.createPreviewSession('grace-preview', blog.userId, blog.id, '2099-01-01T00:00:00.000Z', theme.config);
    const publish = database.createPublishOperation(blog.userId, blog.id, 'grace-preview');
    database.completeSync(blog.id, { title: 'Grace', description: '', author: 'Grace', draftArtifact: draft });
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;
    await expect(new OperationWorker(database, config).execute(publish)).rejects.toThrow('Draft changed before publishing');
    expect(database.getActiveRelease(blog.id)).toBeNull();
    database.close();
  });

  it('removes the immutable artifact if the release transaction fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-publish-switch-failure-')); roots.push(root);
    const database = new AppDatabase(root); const date = new Date();
    database.db.insert(user).values({ id: '77777777-7777-4777-8777-777777777777', name: 'atomic', email: 'atomic@users.vibelog.invalid', emailVerified: false, username: 'atomic', displayUsername: 'atomic', createdAt: date, updatedAt: date }).run();
    const { blog, operation } = database.createBlog('77777777-7777-4777-8777-777777777777', 'atomic', 'atomic'); database.completeOperation(operation.id);
    const draft = join(root, 'draft'); await mkdir(draft); await writeFile(join(draft, 'index.html'), '<h1>Draft</h1>');
    database.completeSync(blog.id, { title: 'Atomic', description: '', author: 'Atomic', draftArtifact: draft });
    const theme = database.getActiveTheme(blog.id); if (!theme) throw new Error('Theme missing');
    database.createPreviewSession('atomic-preview', blog.userId, blog.id, '2099-01-01T00:00:00.000Z', theme.config);
    const publish = database.createPublishOperation(blog.userId, blog.id, 'atomic-preview');
    const activate = vi.spyOn(database, 'activateRelease').mockImplementationOnce(() => { throw new Error('release transaction failed'); });

    await expect(new OperationWorker(database, { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig).execute(publish)).rejects.toThrow('release transaction failed');

    expect(database.getActiveRelease(blog.id)).toBeNull();
    expect(await readdir(join(root, 'blogs', blog.userId, blog.id, 'releases'))).toEqual([]);
    activate.mockRestore(); database.close();
  });
});

describe('operationPublicError', () => {
  it('maps structured HackMD failures to actionable messages without echoing technical details', () => {
    const messages = new Map([
      ['profile_not_found', '找不到這個公開 HackMD 使用者，請確認 username 後再試一次。'],
      ['article_not_found', '同步期間有公開文章消失或無法讀取，請重新整理 HackMD 後再試一次。'],
      ['rate_limited', 'HackMD 暫時限制同步請求，請稍後再試一次。'],
      ['request_timeout', 'HackMD 暫時無法穩定回應，請稍後再試一次。'],
      ['invalid_response', 'HackMD 回應格式暫時無法辨識，請稍後再試一次。'],
      ['too_many_articles', 'VibeLog 一次最多同步 200 篇公開文章。'],
      ['article_too_large', '有 HackMD 文章超過 2 MiB，請縮短內容後再同步。'],
      ['sync_too_large', '公開文章內容合計超過 32 MiB，請減少內容後再同步。'],
    ] as const);
    for (const [code, expected] of messages) {
      const error = new HackMdSourceError(code, 'secret external response body');
      expect(operationPublicError('sync', error)).toBe(expected);
      expect(operationPublicError('sync', error)).not.toContain('secret');
    }
  });
});
