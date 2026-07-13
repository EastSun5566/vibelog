import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { loadAppConfig } from '../src/config.js';
import { projectRoot } from '../src/security/path.js';

describe('SaaS security boundary', () => {
  let root: string;
  let instance: ReturnType<typeof createApp>;
  let cookie: string;
  let csrf: string;
  let userId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibelog-app-'));
    const config = loadAppConfig({
      NODE_ENV: 'test',
      DATA_ROOT: root,
      APP_ORIGIN: 'http://app.test',
      PREVIEW_ORIGIN: 'http://preview.test',
      SESSION_SECRET: 'test-only-secret',
    });
    instance = createApp({ config });
    const login = await instance.app.request('http://app.test/auth/dev-login');
    const loginCookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    if (!loginCookie) throw new Error('Development login did not set a session cookie');
    cookie = loginCookie;
    const session = await instance.app.request('http://app.test/api/session', { headers: { cookie } });
    const sessionData = (await session.json()) as { csrfToken: string; user: { id: string } };
    csrf = sessionData.csrfToken;
    userId = sessionData.user.id;
  });

  afterEach(async () => {
    instance.database.close();
    await rm(root, { recursive: true, force: true });
  });

  function mutation(body: unknown, extraHeaders: Record<string, string> = {}) {
    return {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://app.test',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    };
  }

  async function createProject() {
    const response = await instance.app.request('http://app.test/api/projects', mutation({
      name: '測試專案',
      source: { type: 'hackmd', username: 'public-user' },
      language: 'zh-Hant',
    }));
    expect(response.status).toBe(202);
    return (await response.json()) as { project: { id: string }; jobId: string; status: string };
  }

  it('keeps health public and mutations authenticated', async () => {
    expect((await instance.app.request('http://app.test/health')).status).toBe(200);
    const response = await instance.app.request('http://app.test/api/projects', {
      method: 'POST',
      headers: { origin: 'http://app.test', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    const error = await response.json() as unknown;
    const envelope = error as { error: { code: string; requestId: unknown } };
    expect(envelope.error.code).toBe('authentication_required');
    expect(typeof envelope.error.requestId).toBe('string');
  });

  it('requires a trusted Origin and synchronizer CSRF token', async () => {
    const missingCsrf = await instance.app.request('http://app.test/api/projects', {
      ...mutation({ name: 'x', source: { type: 'hackmd', username: 'user' } }),
      headers: { cookie, origin: 'http://app.test', 'content-type': 'application/json' },
    });
    expect(missingCsrf.status).toBe(403);

    const evilOrigin = await instance.app.request('http://app.test/api/projects', mutation(
      { name: 'x', source: { type: 'hackmd', username: 'user' } },
      { origin: 'https://evil.example' },
    ));
    expect(evilOrigin.status).toBe(403);
    expect(evilOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('creates server UUIDs, queues persistent jobs, and reports conflicts', async () => {
    const created = await createProject();
    expect(created.project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.status).toBe('queued');

    const job = await instance.app.request(`http://app.test/api/jobs/${created.jobId}`, { headers: { cookie } });
    expect(job.status).toBe(200);
    expect(await job.json()).toMatchObject({ job: { status: 'queued', type: 'sync' } });

    const busy = await instance.app.request(`http://app.test/api/projects/${created.project.id}/build`, mutation({}));
    expect(busy.status).toBe(409);

    const detail = await instance.app.request(`http://app.test/projects/${created.project.id}?job=${created.jobId}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain('id="job-status"');
    expect(detail.headers.get('content-security-policy')).toContain('script-src \'self\'');

    const client = await instance.app.request('http://app.test/assets/app.js');
    const clientSource = await client.text();
    expect(clientSource).toContain('fetch(\'/api/jobs/\'');
    expect(clientSource).toContain('button.disabled = true');
  });

  it('never returns credential secrets', async () => {
    const created = await instance.app.request('http://app.test/api/credentials', mutation({
      type: 'cloudflare', label: 'Production', token: 'top-secret-token', accountId: 'account-123456',
    }));
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain('top-secret-token');

    const listed = await instance.app.request('http://app.test/api/credentials', { headers: { cookie } });
    const text = await listed.text();
    expect(text).not.toContain('top-secret-token');
    expect(text).not.toContain('ciphertext');
    expect(text).toContain('3456');
  });

  it('hides projects owned by another user', async () => {
    const other = instance.database.upsertUser({ issuer: 'test', subject: 'other', email: null, displayName: null });
    const project = instance.database.createProject({
      userId: other.id,
      name: 'Private',
      slug: 'private',
      sourceType: 'hackmd',
      sourceConfig: { username: 'other' },
    });
    const response = await instance.app.request(`http://app.test/api/projects/${project.id}`, { headers: { cookie } });
    expect(response.status).toBe(404);
  });

  it('reports malformed public IDs as client errors', async () => {
    const project = await instance.app.request('http://app.test/api/projects/not-a-uuid', { headers: { cookie } });
    expect(project.status).toBe(400);
    expect(await project.json()).toMatchObject({ error: { code: 'invalid_id' } });

    const job = await instance.app.request('http://app.test/api/jobs/not-a-uuid', { headers: { cookie } });
    expect(job.status).toBe(400);
    expect(await job.json()).toMatchObject({ error: { code: 'invalid_id' } });
  });

  it('serves previews only on the isolated origin with a scoped cookie', async () => {
    const created = await createProject();
    const dist = join(projectRoot(root, userId, created.project.id), 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<h1>isolated preview</h1>');

    const grant = await instance.app.request(`http://app.test/api/projects/${created.project.id}/preview-session`, mutation({}));
    const { url } = await grant.json() as { url: string };
    const wrongOrigin = await instance.app.request(url.replace('preview.test', 'app.test'));
    expect(wrongOrigin.status).toBe(404);

    const access = await instance.app.request(url);
    expect(access.status).toBe(302);
    const previewCookie = access.headers.get('set-cookie')?.split(';', 1)[0];
    if (!previewCookie) throw new Error('Preview grant did not set a cookie');
    expect(access.headers.get('set-cookie')).toContain(`/preview/${created.project.id}`);
    const preview = await instance.app.request(`http://preview.test/preview/${created.project.id}/`, { headers: { cookie: previewCookie } });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('isolated preview');
    expect(preview.headers.get('content-security-policy')).toContain('script-src \'none\'');
  });
});
