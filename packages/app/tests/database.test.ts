import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@vibelog/core';
import { AppDatabase, AiQuotaExceededError } from '../src/database.js';
import { user } from '../src/schema.js';

const roots: string[] = [];
async function subject() { const root = await mkdtemp(join(tmpdir(), 'vibelog-db-')); roots.push(root); return new AppDatabase(root); }
function addUser(database: AppDatabase, id: string, username: string) { const date = new Date(); database.db.insert(user).values({ id, name: username, email: `${username}@users.vibelog.invalid`, emailVerified: false, username, displayUsername: username, createdAt: date, updatedAt: date }).run(); }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('AppDatabase 0.5 model', () => {
  it('refuses a pre-0.5 volume instead of attempting a partial migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-legacy-')); roots.push(root);
    const legacy = new DatabaseSync(join(root, 'vibelog.sqlite'));
    legacy.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    legacy.close();
    expect(() => new AppDatabase(root)).toThrow('pre-0.5');
  });
  it('enforces one blog per user and immutable revision activation', async () => {
    const database = await subject(); addUser(database, '11111111-1111-4111-8111-111111111111', 'alice');
    const { blog, operation } = database.createBlog('11111111-1111-4111-8111-111111111111', 'alice', 'hackmd-alice');
    expect(() => database.createBlog(blog.userId, 'alice-two', 'other')).toThrow();
    database.completeOperation(operation.id);
    const second = database.createTheme(blog.id, { ...DEFAULT_THEME, description: 'Second safe theme' }, 'change');
    expect(database.listThemes(blog.id)).toHaveLength(2);
    const first = database.listThemes(blog.id).find((theme) => theme.id !== second.id);
    expect(first).toBeDefined();
    if (!first) throw new Error('Initial theme missing');
    database.activateTheme(first.id, blog.id);
    expect(database.getActiveTheme(blog.id)?.id).toBe(first.id);
    database.close();
  });
  it('charges accepted AI work and rejects user/global quota without creating work', async () => {
    const database = await subject(); addUser(database, '22222222-2222-4222-8222-222222222222', 'bob');
    const { blog, operation } = database.createBlog('22222222-2222-4222-8222-222222222222', 'bob', 'bob'); database.completeOperation(operation.id);
    const first = database.createThemeOperation(blog.userId, blog.id, 'one', { userDailyLimit: 1, globalDailyLimit: 5, at: new Date('2026-07-19T12:00:00Z') });
    database.completeOperation(first.id);
    expect(() => database.createThemeOperation(blog.userId, blog.id, 'two', { userDailyLimit: 1, globalDailyLimit: 5, at: new Date('2026-07-19T13:00:00Z') })).toThrow(AiQuotaExceededError);
    database.close();
  });
});
