import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/database.js';
import { loadAppConfig } from '../src/config.js';
import { JobWorker } from '../src/jobs.js';
import { decryptJson, encryptJson } from '../src/security/crypto.js';
import { assertNoSymlinkEscape, projectRoot, resolveRelativeWithin, resolveWithin } from '../src/security/path.js';

describe('path, secret, and job invariants', () => {
  let root: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vibelog-security-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('rejects absolute and parent traversal path segments', () => {
    expect(() => resolveWithin(root, '../outside')).toThrow('Unsafe path segment');
    expect(() => resolveWithin(root, '/tmp/outside')).toThrow('Unsafe path segment');
    expect(() => resolveRelativeWithin(root, '../../outside')).toThrow('Path escapes');
    expect(() => resolveRelativeWithin(root, '%2e%2e%2foutside')).toThrow('Unsafe request path');
  });

  it('rejects symlink escapes', async () => {
    const preview = join(root, 'preview');
    const outside = join(root, 'outside');
    await mkdir(preview);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(preview, 'leak.txt'));
    await expect(assertNoSymlinkEscape(preview, join(preview, 'leak.txt'))).rejects.toThrow('Symbolic links');
  });

  it('rejects symlinks even when they resolve within the preview root', async () => {
    const preview = join(root, 'preview');
    await mkdir(join(preview, 'real'), { recursive: true });
    await writeFile(join(preview, 'real', 'index.html'), 'private');
    await symlink(join(preview, 'real'), join(preview, 'alias'));
    await expect(assertNoSymlinkEscape(preview, join(preview, 'alias', 'index.html'))).rejects.toThrow('Symbolic links');
  });

  it('detects authenticated-encryption tampering', () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptJson({ token: 'secret' }, key);
    expect(decryptJson(encrypted, key)).toEqual({ token: 'secret' });
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}AA`;
    expect(() => decryptJson(encrypted, key)).toThrow();
  });

  it('serializes jobs by project and recovers running work after restart', () => {
    const database = new AppDatabase(root);
    const user = database.upsertUser({ issuer: 'test', subject: 'one', email: null, displayName: null });
    const project = database.createProject({
      userId: user.id,
      name: 'One',
      slug: 'one',
      sourceType: 'hackmd',
      sourceConfig: { username: 'one' },
    });
    const first = database.createJob(user.id, project.id, 'sync');
    expect(() => database.createJob(user.id, project.id, 'build')).toThrow('UNIQUE constraint failed');
    expect(database.claimNextJob()).toMatchObject({ id: first.id, status: 'running', attempts: 1 });
    database.recoverRunningJobs();
    expect(database.getJob(first.id, user.id)).toMatchObject({ status: 'queued' });
    expect(projectRoot(root, user.id, project.id)).toBe(join(root, 'projects', user.id, project.id));
    database.close();
  });

  it('marks failed jobs without replacing the previous build output', async () => {
    const database = new AppDatabase(root);
    const user = database.upsertUser({ issuer: 'test', subject: 'failure', email: null, displayName: null });
    const project = database.createProject({
      userId: user.id,
      name: 'Failure',
      slug: 'failure',
      sourceType: 'hackmd',
      sourceConfig: { username: 'failure' },
    });
    const output = join(projectRoot(root, user.id, project.id), 'dist');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'previous.html'), 'previous');
    const job = database.createJob(user.id, project.id, 'build');
    const worker = new JobWorker(database, loadAppConfig({
      NODE_ENV: 'test',
      DATA_ROOT: root,
      APP_ORIGIN: 'http://app.test',
      PREVIEW_ORIGIN: 'http://preview.test',
    }));

    expect(await worker.runOnce()).toBe(true);
    expect(database.getJob(job.id, user.id)).toMatchObject({ status: 'failed', errorCode: 'job_failed' });
    expect(database.getProject(project.id, user.id)).toMatchObject({ state: 'failed' });
    expect(await readFile(join(output, 'previous.html'), 'utf8')).toBe('previous');
    database.close();
  });

  it('completes deletion as a durable job while retaining job status', async () => {
    const database = new AppDatabase(root);
    const user = database.upsertUser({ issuer: 'test', subject: 'delete', email: null, displayName: null });
    const project = database.createProject({
      userId: user.id,
      name: 'Delete',
      slug: 'delete',
      sourceType: 'hackmd',
      sourceConfig: { username: 'delete' },
    });
    const projectPath = projectRoot(root, user.id, project.id);
    await mkdir(projectPath, { recursive: true });
    const job = database.createJob(user.id, project.id, 'delete');
    const worker = new JobWorker(database, loadAppConfig({
      NODE_ENV: 'test',
      DATA_ROOT: root,
      APP_ORIGIN: 'http://app.test',
      PREVIEW_ORIGIN: 'http://preview.test',
    }));

    expect(await worker.runOnce()).toBe(true);
    expect(database.getProject(project.id, user.id)).toBeNull();
    expect(database.getJob(job.id, user.id)).toMatchObject({ status: 'succeeded' });
    database.close();
  });
});
