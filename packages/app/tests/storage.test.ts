import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlogStorageReference } from '../src/database.js';
import { reconcileStorage } from '../src/storage.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe('storage reconciliation', () => {
  it('removes only recognized unreferenced artifacts without following symlinks', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'vibelog-storage-')); roots.push(dataRoot);
    const outside = await mkdtemp(join(tmpdir(), 'vibelog-storage-outside-')); roots.push(outside);
    const userId = '11111111-1111-4111-8111-111111111111';
    const blogId = '22222222-2222-4222-8222-222222222222';
    const root = join(dataRoot, 'blogs', userId, blogId);
    const currentDraft = join(root, 'drafts', '33333333-3333-4333-8333-333333333333');
    const orphanDraft = join(root, 'drafts', '44444444-4444-4444-8444-444444444444');
    const linkedDraft = join(root, 'drafts', '55555555-5555-4555-8555-555555555555');
    const activeRelease = join(root, 'releases', '66666666-6666-4666-8666-666666666666');
    const inactiveRelease = join(root, 'releases', '77777777-7777-4777-8777-777777777777');
    const orphanRelease = join(root, 'releases', '88888888-8888-4888-8888-888888888888');
    const syncStaging = join(root, '.sync-99999999-9999-4999-8999-999999999999');
    const releaseStaging = join(root, 'releases', '.staging-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const legacyDraft = join(root, 'draft');
    const unknown = join(root, 'keep-me');

    await Promise.all([currentDraft, orphanDraft, activeRelease, inactiveRelease, orphanRelease, syncStaging, releaseStaging, legacyDraft, unknown, outside].map((path) => mkdir(path, { recursive: true })));
    await writeFile(join(outside, 'outside.txt'), 'keep');
    await symlink(outside, linkedDraft);

    const references: BlogStorageReference[] = [{ userId, blogId, draftArtifact: currentDraft, releaseArtifacts: [activeRelease, inactiveRelease] }];
    const result = await reconcileStorage(dataRoot, references);

    expect(result).toEqual({ removed: 6, warnings: 0 });
    expect(await Promise.all([currentDraft, activeRelease, inactiveRelease, unknown].map(exists))).toEqual([true, true, true, true]);
    expect(await Promise.all([orphanDraft, linkedDraft, orphanRelease, syncStaging, releaseStaging, legacyDraft].map(exists))).toEqual([false, false, false, false, false, false]);
    expect(await readFile(join(outside, 'outside.txt'), 'utf8')).toBe('keep');
  });

  it('reports unsafe structures and missing references without deleting unknown data', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'vibelog-storage-warning-')); roots.push(dataRoot);
    const outside = await mkdtemp(join(tmpdir(), 'vibelog-storage-warning-outside-')); roots.push(outside);
    const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const blogId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const root = join(dataRoot, 'blogs', userId, blogId);
    await mkdir(root, { recursive: true });
    await writeFile(join(outside, 'outside.txt'), 'keep');
    await symlink(outside, join(root, 'releases'));
    await mkdir(join(root, 'custom-data'));

    const missingDraft = join(root, 'drafts', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const result = await reconcileStorage(dataRoot, [{ userId, blogId, draftArtifact: missingDraft, releaseArtifacts: [] }]);

    expect(result).toEqual({ removed: 0, warnings: 2 });
    expect(await readFile(join(outside, 'outside.txt'), 'utf8')).toBe('keep');
    expect(await exists(join(root, 'custom-data'))).toBe(true);
    expect(await exists(join(root, 'releases'))).toBe(true);
  });
});
