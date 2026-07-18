import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectRoot } from '../src/security/path.js';
import { makeTestApp, register, TEST_ORIGIN } from './helpers.js';

describe('SaaS security boundary', () => {
  let root: string;
  let instance: ReturnType<typeof makeTestApp>;
  let cookie: string;
  let csrf: string;
  let userId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibelog-app-'));
    instance = makeTestApp(root);
    cookie = (await register(instance)).cookie;
    const session = await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie } });
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
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    };
  }

  async function createProject() {
    const response = await instance.app.request(`${TEST_ORIGIN}/api/projects`, mutation({
      name: '測試專案',
      source: { type: 'hackmd', username: 'public-user' },
      language: 'zh-Hant',
    }));
    expect(response.status).toBe(202);
    return (await response.json()) as { project: { id: string }; jobId: string; status: string };
  }

  it('keeps health public and mutations authenticated', async () => {
    expect((await instance.app.request(`${TEST_ORIGIN}/health`)).status).toBe(200);
    const response = await instance.app.request(`${TEST_ORIGIN}/api/projects`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    const error = await response.json() as unknown;
    const envelope = error as { error: { code: string; requestId: unknown } };
    expect(envelope.error.code).toBe('authentication_required');
    expect(typeof envelope.error.requestId).toBe('string');
  });

  it('requires a trusted Origin and synchronizer CSRF token', async () => {
    const missingCsrf = await instance.app.request(`${TEST_ORIGIN}/api/projects`, {
      ...mutation({ name: 'x', source: { type: 'hackmd', username: 'user' } }),
      headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
    });
    expect(missingCsrf.status).toBe(403);

    const evilOrigin = await instance.app.request(`${TEST_ORIGIN}/api/projects`, mutation(
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

    const job = await instance.app.request(`${TEST_ORIGIN}/api/jobs/${created.jobId}`, { headers: { cookie } });
    expect(job.status).toBe(200);
    expect(await job.json()).toMatchObject({ job: { status: 'queued', type: 'sync' } });

    const busy = await instance.app.request(`${TEST_ORIGIN}/api/projects/${created.project.id}/build`, mutation({}));
    expect(busy.status).toBe(409);

    const detail = await instance.app.request(`${TEST_ORIGIN}/projects/${created.project.id}?job=${created.jobId}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain('id="job-status"');
    expect(detail.headers.get('content-security-policy')).toContain('script-src \'self\'');
    const proxiedDetail = await instance.app.request(`http://app.test/projects/${created.project.id}`, { headers: { cookie } });
    expect(proxiedDetail.headers.get('content-security-policy')).toContain('script-src \'self\'');

    const client = await instance.app.request(`${TEST_ORIGIN}/assets/app.js`);
    const clientSource = await client.text();
    expect(clientSource).toContain('fetch(\'/api/jobs/\'');
    expect(clientSource).toContain('button.disabled = true');
  });

  it('returns a stable 429 response after the daily AI user quota', async () => {
    const created = await createProject();
    instance.database.completeJob(created.jobId);
    for (let index = 0; index < 20; index += 1) {
      const response = await instance.app.request(`${TEST_ORIGIN}/api/projects/${created.project.id}/style`, mutation({ prompt: `style ${String(index)}` }));
      expect(response.status).toBe(202);
      const { jobId } = await response.json() as { jobId: string };
      instance.database.completeJob(jobId);
    }
    const limited = await instance.app.request(`${TEST_ORIGIN}/api/projects/${created.project.id}/style`, mutation({ prompt: 'one too many' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await limited.json()).toMatchObject({ error: { code: 'ai_quota_exceeded' } });
  });

  it('never returns credential secrets', async () => {
    const created = await instance.app.request(`${TEST_ORIGIN}/api/credentials`, mutation({
      type: 'cloudflare', label: 'Production', token: 'top-secret-token', accountId: 'account-123456',
    }));
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain('top-secret-token');

    const listed = await instance.app.request(`${TEST_ORIGIN}/api/credentials`, { headers: { cookie } });
    const text = await listed.text();
    expect(text).not.toContain('top-secret-token');
    expect(text).not.toContain('ciphertext');
    expect(text).toContain('3456');
  });

  it('hides projects owned by another user', async () => {
    const otherCookie = (await register(instance, { username: 'bob' })).cookie;
    const otherSession = await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: otherCookie } });
    const { csrfToken: otherCsrf } = await otherSession.json() as { csrfToken: string };
    const otherMutation = (body: unknown) => ({
      method: 'POST',
      headers: { cookie: otherCookie, origin: TEST_ORIGIN, 'content-type': 'application/json', 'x-csrf-token': otherCsrf },
      body: JSON.stringify(body),
    });
    const created = await instance.app.request(`${TEST_ORIGIN}/api/projects`, otherMutation({
      name: 'Private', source: { type: 'hackmd', username: 'bob' },
    }));
    const { project, jobId } = await created.json() as { project: { id: string }; jobId: string };
    expect((await instance.app.request(`${TEST_ORIGIN}/api/projects/${project.id}`, { headers: { cookie } })).status).toBe(404);
    expect((await instance.app.request(`${TEST_ORIGIN}/api/jobs/${jobId}`, { headers: { cookie } })).status).toBe(404);
    expect((await instance.app.request(`${TEST_ORIGIN}/api/projects/${project.id}/preview-session`, mutation({}))).status).toBe(404);

    await instance.app.request(`${TEST_ORIGIN}/api/credentials`, otherMutation({
      type: 'notion', label: 'Bob only', token: 'bob-secret',
    }));
    expect(await (await instance.app.request(`${TEST_ORIGIN}/api/credentials`, { headers: { cookie } })).json()).toEqual({ credentials: [] });
  });

  it('reports malformed public IDs as client errors', async () => {
    const project = await instance.app.request(`${TEST_ORIGIN}/api/projects/not-a-uuid`, { headers: { cookie } });
    expect(project.status).toBe(400);
    expect(await project.json()).toMatchObject({ error: { code: 'invalid_id' } });

    const job = await instance.app.request(`${TEST_ORIGIN}/api/jobs/not-a-uuid`, { headers: { cookie } });
    expect(job.status).toBe(400);
    expect(await job.json()).toMatchObject({ error: { code: 'invalid_id' } });
  });

  it('serves previews only on the isolated origin with a scoped cookie', async () => {
    const created = await createProject();
    const dist = join(projectRoot(root, userId, created.project.id), 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<h1>isolated preview</h1>');

    const grant = await instance.app.request(`${TEST_ORIGIN}/api/projects/${created.project.id}/preview-session`, mutation({}));
    const { url } = await grant.json() as { url: string };
    const wrongOrigin = await instance.app.request(url.replace('preview.test', 'app.test'));
    expect(wrongOrigin.status).toBe(404);

    const access = await instance.app.request(url.replace('https://', 'http://'));
    expect(access.status).toBe(302);
    const previewCookie = access.headers.get('set-cookie')?.split(';', 1)[0];
    if (!previewCookie) throw new Error('Preview grant did not set a cookie');
    expect(access.headers.get('set-cookie')).toContain(`/preview/${created.project.id}`);
    expect(access.headers.get('set-cookie')).toContain('Secure');
    const preview = await instance.app.request(`http://preview.test/preview/${created.project.id}/`, { headers: { cookie: previewCookie } });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('isolated preview');
    expect(preview.headers.get('content-security-policy')).toContain('script-src \'none\'');
  });
});
