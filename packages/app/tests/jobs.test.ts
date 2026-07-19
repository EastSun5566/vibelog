import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@vibelog/core';
import type { AiProvider, ThemeConfig } from '@vibelog/core';
import type { AppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { OperationWorker } from '../src/jobs.js';
import { user } from '../src/schema.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('OperationWorker publication snapshots', () => {
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
    database.completeSync(blog.id, { title: 'Frank', description: '', author: 'Frank', draftArtifact: draft });
    const selectedTheme = database.getActiveTheme(blog.id); if (!selectedTheme) throw new Error('Theme missing');
    database.createPreviewSession('frank-preview', blog.userId, blog.id, '2099-01-01T00:00:00.000Z', selectedTheme.config);
    const publish = database.createPublishOperation(blog.userId, blog.id, 'frank-preview');
    database.createTheme(blog.id, { ...DEFAULT_THEME, appearance: 'dark', colors: { ...DEFAULT_THEME.colors, background: '#111111', surface: '#222222', text: '#ffffff', muted: '#c0c0c0', accent: '#80caff', border: '#555555' }, description: 'A later theme' }, 'later change');
    const config = { dataRoot: root, appOrigin: 'http://app.localtest.me:3000' } as AppConfig;
    await new OperationWorker(database, config).execute(publish);
    const release = database.getActiveRelease(blog.id);
    expect(release).toMatchObject({ themeRevisionId: selectedTheme.id, contentVersion: 1 });
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
});
