import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseBackup } from '../src/backup.js';
import { AppDatabase } from '../src/database.js';
import { user } from '../src/schema.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('database backup', () => {
  it('creates a consistent copy without stopping the live SQLite connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-backup-')); roots.push(root);
    const database = new AppDatabase(root);
    const at = new Date();
    database.db.insert(user).values({ id: '89898989-8989-4989-8989-898989898989', name: 'backup', email: 'backup@users.vibelog.invalid', emailVerified: false, username: 'backup', displayUsername: 'backup', createdAt: at, updatedAt: at }).run();
    const destination = join(root, 'backups', 'staging.sqlite');

    const result = await createDatabaseBackup(root, destination);

    expect(result).toMatchObject({ backup: destination, integrityCheck: 'ok' });
    await expect(access(destination)).resolves.toBeUndefined();
    const copy = new DatabaseSync(destination, { readOnly: true });
    expect(copy.prepare('SELECT COUNT(*) AS count FROM user').get()).toMatchObject({ count: 1 });
    copy.close();
    await expect(createDatabaseBackup(root, destination)).rejects.toThrow('already exists');
    database.close();
  });
});
