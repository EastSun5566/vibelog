import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { slugify } from '@vibelog/core';
import type { AppVariables } from './auth.js';
import { OidcService, clearSession, readSession, setSession } from './auth.js';
import { loadAppConfig, type AppConfig } from './config.js';
import { AppDatabase, type JobType, type ProjectRecord } from './database.js';
import { listCloudflareDeployments } from './deploy/cloudflare.js';
import { AppError, assertCsrfToken, assertMutationOrigin, corsPolicy, jsonError, requestContext } from './http.js';
import { decryptJson, encryptJson, hashToken, randomToken } from './security/crypto.js';
import { assertNoSymlinkEscape, assertUuid, projectRoot, resolveRelativeWithin } from './security/path.js';

const projectInput = z.object({
  name: z.string().trim().min(1).max(100),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('hackmd'), username: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u) }),
    z.object({ type: z.literal('notion'), databaseId: z.string().trim().min(1).max(100), credentialId: z.string().uuid() }),
  ]),
  language: z.string().trim().min(2).max(35).optional(),
});
const credentialInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notion'), label: z.string().trim().min(1).max(80), token: z.string().min(1).max(1000) }),
  z.object({
    type: z.literal('cloudflare'),
    label: z.string().trim().min(1).max(80),
    token: z.string().min(1).max(1000),
    accountId: z.string().trim().min(1).max(100),
  }),
]);
const styleInput = z.object({ prompt: z.string().trim().min(1).max(2000) });
const deployInput = z.object({
  credentialId: z.string().uuid(),
  projectName: z.string().trim().min(1).max(58).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
  branch: z.string().trim().min(1).max(100).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('invalid_request', result.error.issues[0]?.message ?? 'Invalid request', 400);
  return result.data;
}

function parseUuid(value: string, name = 'id'): string {
  try {
    return assertUuid(value, name);
  } catch {
    throw new AppError('invalid_id', `Invalid ${name}`, 400);
  }
}

function contentType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function projectJson(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    source: { type: project.sourceType, ...project.sourceConfig },
    state: project.state,
    lastError: project.lastError,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function page(title: string, body: unknown, nonce: string, jobId?: string) {
  return <html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>{title} · VibeLog</title><style nonce={nonce}>{'body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:64rem;margin:auto;padding:2rem;line-height:1.5;color:#18212f}nav{display:flex;gap:1rem}a{color:#075fd7}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #e66b00;outline-offset:3px}.grid{display:grid;gap:1rem}.card{border:1px solid #ccd3dd;border-radius:.75rem;padding:1rem}.muted{color:#52606f}code{overflow-wrap:anywhere}form{display:grid;gap:.75rem;max-width:36rem;margin:1rem 0}input,textarea,select,button{font:inherit;padding:.55rem}button{width:max-content}@media(prefers-color-scheme:dark){body{background:#111827;color:#f3f4f6}.card{border-color:#4b5563}a{color:#7cb8ff}.muted{color:#b9c2cf}}'}</style></head><body data-job-id={jobId}><header><h1>VibeLog</h1><nav aria-label="主要導覽"><a href="/projects">專案</a><a href="/projects/new">建立專案</a><a href="/api/credentials">憑證 API</a></nav></header><main>{jobId ? <p id="job-status" class="card" aria-live="polite">工作已排入佇列…</p> : null}{body}</main><script src="/assets/app.js" defer></script></body></html>;
}

const managementScript = `
for (const form of document.querySelectorAll('form')) {
  form.addEventListener('submit', () => {
    for (const button of form.querySelectorAll('button[type="submit"],button:not([type])')) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
  });
}
const jobId = document.body.dataset.jobId;
const statusNode = document.querySelector('#job-status');
if (jobId && statusNode) {
  const poll = async () => {
    try {
      const response = await fetch('/api/jobs/' + encodeURIComponent(jobId), { credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || '無法讀取工作狀態');
      const job = payload.job;
      statusNode.textContent = '工作狀態：' + job.status + (job.errorMessage ? ' — ' + job.errorMessage : '');
      if (job.status === 'succeeded') {
        const next = new URL(location.href);
        next.searchParams.delete('job');
        setTimeout(() => location.replace(next), 400);
        return;
      }
      if (job.status === 'failed') return;
      setTimeout(poll, 1000);
    } catch (error) {
      statusNode.textContent = error instanceof Error ? error.message : '無法讀取工作狀態';
    }
  };
  void poll();
}
`;

export interface CreateAppOptions { config?: AppConfig; database?: AppDatabase }
interface AppEnv { Variables: AppVariables }
type AppContext = Context<AppEnv>;

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadAppConfig();
  const database = options.database ?? new AppDatabase(config.dataRoot);
  const oidc = config.oidc ? new OidcService(database, config.oidc) : null;
  const app = new Hono<AppEnv>();

  app.use('*', requestContext());
  app.use('*', corsPolicy(config));
  app.use('*', async (c, next) => {
    await next();
    if (new URL(c.req.url).origin === config.appOrigin && c.res.headers.get('content-type')?.includes('text/html')) {
      c.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'nonce-${c.get('cspNonce')}'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
    }
  });
  app.onError((error, c) => jsonError(c, error));
  app.notFound((c) => jsonError(c, new AppError('not_found', 'Resource not found', 404)));

  app.get('/health', (c) => c.json({ status: 'ok', service: 'vibelog-saas' }));
  app.get('/assets/app.js', (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(managementScript);
  });
  app.get('/auth/login', async (c) => {
    if (!oidc) throw new AppError('oidc_not_configured', 'OIDC is not configured', 503);
    return c.redirect((await oidc.authorizationUrl()).href);
  });
  app.get('/auth/callback', async (c) => {
    if (!oidc) throw new AppError('oidc_not_configured', 'OIDC is not configured', 503);
    const user = await oidc.finish(new URL(c.req.url));
    setSession(c, database, config, user.id);
    return c.redirect('/projects');
  });
  app.post('/auth/logout', (c) => {
    const session = readSession(c, database, config);
    if (!session) throw new AppError('authentication_required', 'Authentication is required', 401);
    assertMutationOrigin(c, config);
    assertCsrfToken(c.req.header('x-csrf-token'), session.csrfToken);
    clearSession(c, database, config);
    return c.body(null, 204);
  });
  if (config.nodeEnv !== 'production' && !oidc) {
    app.get('/auth/dev-login', (c) => {
      const user = database.upsertUser({ issuer: 'dev', subject: 'local', email: null, displayName: 'Local developer' });
      setSession(c, database, config, user.id);
      return c.redirect('/projects');
    });
  }

  const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
    const session = readSession(c, database, config);
    if (!session) throw new AppError('authentication_required', 'Authentication is required', 401);
    c.set('session', session);
    await next();
  };
  app.use('/api/*', requireSession);
  app.use('/projects', requireSession);
  app.use('/projects/*', requireSession);

  function requestedJob(c: AppContext, projectId?: string): string | undefined {
    const requestedId = c.req.query('job');
    if (!requestedId) return undefined;
    const job = database.getJob(parseUuid(requestedId, 'job id'), c.get('session').user.id);
    if (!job || (projectId && job.projectId !== projectId)) {
      throw new AppError('job_not_found', 'Job not found', 404);
    }
    return job.id;
  }

  app.get('/', (c) => c.redirect(readSession(c, database, config) ? '/projects' : '/auth/login'));
  app.get('/projects', (c) => {
    const projects = database.listProjects(c.get('session').user.id);
    return c.html(page('專案', <><h2>專案</h2><p class="muted">所有建置、同步、樣式、部署與刪除都由持久化工作處理。</p><div class="grid">{projects.map((project) => <article class="card"><h3><a href={`/projects/${project.id}`}>{project.name}</a></h3><p>狀態：<span aria-live="polite">{project.state}</span></p><code>{project.id}</code></article>)}</div></>, c.get('cspNonce'), requestedJob(c)));
  });
  app.get('/projects/new', (c) => c.html(page('建立專案', <><h2>建立 HackMD 專案</h2><form method="post" action="/projects"><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><label for="name">專案名稱</label><input id="name" name="name" required maxlength={100}/><label for="username">公開 HackMD 帳號</label><input id="username" name="username" required maxlength={100}/><label for="language">網站語言</label><input id="language" name="language" value="zh-Hant" maxlength={35}/><button type="submit">建立並同步</button></form></>, c.get('cspNonce'))));
  app.get('/projects/:id', (c) => {
    const project = database.getProject(parseUuid(c.req.param('id')), c.get('session').user.id);
    if (!project) throw new AppError('project_not_found', 'Project not found', 404);
    const csrfToken = c.get('session').csrfToken;
    return c.html(page(project.name, <><h2>{project.name}</h2><dl><dt>狀態</dt><dd aria-live="polite">{project.state}</dd><dt>來源</dt><dd>{project.sourceType}</dd><dt>ID</dt><dd><code>{project.id}</code></dd></dl><form method="post" action={`/projects/${project.id}/build`}><input type="hidden" name="csrfToken" value={csrfToken}/><button type="submit">建置網站</button></form><form method="post" action={`/projects/${project.id}/preview`}><input type="hidden" name="csrfToken" value={csrfToken}/><button type="submit">開啟隔離預覽</button></form><form method="post" action={`/projects/${project.id}/style`}><input type="hidden" name="csrfToken" value={csrfToken}/><label for="prompt">樣式指示</label><textarea id="prompt" name="prompt" required maxlength={2000}></textarea><button type="submit">產生樣式工作</button></form><form method="post" action={`/projects/${project.id}/deploy`}><input type="hidden" name="csrfToken" value={csrfToken}/><label for="credentialId">Cloudflare credential ID</label><input id="credentialId" name="credentialId" required/><label for="projectName">Cloudflare Pages 專案</label><input id="projectName" name="projectName" required/><button type="submit">部署</button></form><form method="post" action={`/projects/${project.id}/delete`}><input type="hidden" name="csrfToken" value={csrfToken}/><button type="submit">刪除專案</button></form></>, c.get('cspNonce'), requestedJob(c, project.id)));
  });

  function mutation(c: AppContext) {
    assertMutationOrigin(c, config);
    assertCsrfToken(c.req.header('x-csrf-token'), c.get('session').csrfToken);
  }
  async function formMutation(c: AppContext) {
    assertMutationOrigin(c, config);
    const body = await c.req.parseBody();
    assertCsrfToken(typeof body.csrfToken === 'string' ? body.csrfToken : undefined, c.get('session').csrfToken);
    return body;
  }
  function ownedProject(c: AppContext) {
    const id = c.req.param('id');
    if (!id) throw new AppError('invalid_project_id', 'Project ID is required', 400);
    const project = database.getProject(parseUuid(id, 'project id'), c.get('session').user.id);
    if (!project) throw new AppError('project_not_found', 'Project not found', 404);
    return project;
  }
  function enqueue(project: ProjectRecord, type: JobType, payload: Record<string, unknown> = {}) {
    try {
      return database.createJob(project.userId, project.id, type, payload);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new AppError('project_busy', 'Project already has an active job', 409);
      throw error;
    }
  }
  function queue(c: AppContext, project: ProjectRecord, type: JobType, payload: Record<string, unknown> = {}) {
    const job = enqueue(project, type, payload);
    return c.json({ jobId: job.id, status: 'queued' as const }, 202);
  }

  app.post('/projects', async (c) => {
    const body = await formMutation(c);
    const input = parse(projectInput, {
      name: body.name,
      source: { type: 'hackmd', username: body.username },
      language: body.language,
    });
    const userId = c.get('session').user.id;
    const baseSlug = slugify(input.name) || 'project';
    const project = database.createProject({ userId, name: input.name, slug: `${baseSlug}-${randomToken(4).toLowerCase()}`, sourceType: 'hackmd', sourceConfig: { ...input.source, language: input.language } });
    const job = database.createJob(userId, project.id, 'sync');
    return c.redirect(`/projects/${project.id}?job=${job.id}`, 303);
  });
  for (const type of ['build', 'delete'] as const) {
    app.post(`/projects/:id/${type}`, async (c) => {
      await formMutation(c);
      const project = ownedProject(c);
      const job = enqueue(project, type);
      return c.redirect(type === 'delete' ? `/projects?job=${job.id}` : `/projects/${project.id}?job=${job.id}`, 303);
    });
  }
  app.post('/projects/:id/style', async (c) => { const body = await formMutation(c); const project = ownedProject(c); const job = enqueue(project, 'style', parse(styleInput, { prompt: body.prompt })); return c.redirect(`/projects/${project.id}?job=${job.id}`, 303); });
  app.post('/projects/:id/deploy', async (c) => { const body = await formMutation(c); const project = ownedProject(c); const job = enqueue(project, 'deploy', parse(deployInput, { credentialId: body.credentialId, projectName: body.projectName })); return c.redirect(`/projects/${project.id}?job=${job.id}`, 303); });
  app.post('/projects/:id/preview', async (c) => {
    await formMutation(c);
    const project = ownedProject(c);
    const token = randomToken();
    database.createPreviewSession(hashToken(token), project.userId, project.id, new Date(Date.now() + 5 * 60_000).toISOString());
    return c.redirect(`${config.previewOrigin}/preview-access/${encodeURIComponent(token)}?project=${project.id}`, 303);
  });

  app.get('/api/session', (c) => c.json({ user: c.get('session').user, csrfToken: c.get('session').csrfToken }));
  app.get('/api/projects', (c) => c.json({ projects: database.listProjects(c.get('session').user.id).map(projectJson) }));
  app.post('/api/projects', async (c) => {
    mutation(c);
    const input = parse(projectInput, await c.req.json().catch(() => null));
    const userId = c.get('session').user.id;
    if (input.source.type === 'notion' && !database.getCredential(input.source.credentialId, userId, 'notion')) {
      throw new AppError('credential_not_found', 'Notion credential not found', 404);
    }
    const baseSlug = slugify(input.name) || 'project';
    const project = database.createProject({ userId, name: input.name, slug: `${baseSlug}-${randomToken(4).toLowerCase()}`, sourceType: input.source.type, sourceConfig: { ...input.source, language: input.language } });
    const job = database.createJob(userId, project.id, 'sync');
    return c.json({ project: projectJson(project), jobId: job.id, status: 'queued' as const }, 202);
  });
  app.get('/api/projects/:id', (c) => c.json({ project: projectJson(ownedProject(c)) }));
  for (const type of ['sync', 'build', 'delete'] as const) {
    app.post(`/api/projects/:id/${type}`, (c) => { mutation(c); return queue(c, ownedProject(c), type); });
  }
  app.post('/api/projects/:id/style', async (c) => { mutation(c); return queue(c, ownedProject(c), 'style', parse(styleInput, await c.req.json().catch(() => null))); });
  app.post('/api/projects/:id/deploy', async (c) => { mutation(c); return queue(c, ownedProject(c), 'deploy', parse(deployInput, await c.req.json().catch(() => null))); });
  app.get('/api/projects/:id/deployments', async (c) => {
    const project = ownedProject(c);
    const credentialId = parse(z.string().uuid(), c.req.query('credentialId'));
    const projectName = parse(z.string().min(1).max(58), c.req.query('projectName'));
    const credential = database.getCredential(credentialId, project.userId, 'cloudflare');
    if (!credential) throw new AppError('credential_not_found', 'Cloudflare credential not found', 404);
    const secret = decryptJson(credential, config.encryptionKey) as { apiToken: string; accountId: string };
    try {
      return c.json({ deployments: await listCloudflareDeployments(secret.accountId, secret.apiToken, projectName) });
    } catch {
      throw new AppError('cloudflare_upstream_error', 'Cloudflare deployment list failed', 502);
    }
  });
  app.get('/api/jobs/:jobId', (c) => {
    const job = database.getJob(parseUuid(c.req.param('jobId'), 'job id'), c.get('session').user.id);
    if (!job) throw new AppError('job_not_found', 'Job not found', 404);
    return c.json({ job });
  });

  app.get('/api/credentials', (c) => c.json({ credentials: database.listCredentials(c.get('session').user.id) }));
  app.post('/api/credentials', async (c) => {
    mutation(c);
    const input = parse(credentialInput, await c.req.json().catch(() => null));
    const encrypted = encryptJson(input.type === 'notion' ? { token: input.token } : { apiToken: input.token, accountId: input.accountId }, config.encryptionKey);
    const credential = database.createCredential({ userId: c.get('session').user.id, type: input.type, label: input.label, metadata: input.type === 'cloudflare' ? { accountIdSuffix: input.accountId.slice(-4) } : {}, ...encrypted });
    return c.json({ credential: { id: credential.id, type: credential.type, label: credential.label, metadata: credential.metadata, createdAt: credential.createdAt } }, 201);
  });

  app.post('/api/projects/:id/preview-session', (c) => {
    mutation(c);
    const project = ownedProject(c);
    const token = randomToken();
    database.createPreviewSession(hashToken(token), project.userId, project.id, new Date(Date.now() + 5 * 60_000).toISOString());
    return c.json({ url: `${config.previewOrigin}/preview-access/${encodeURIComponent(token)}?project=${project.id}`, expiresIn: 300 });
  });
  app.get('/preview-access/:token', (c) => {
    if (new URL(c.req.url).origin !== config.previewOrigin) throw new AppError('wrong_preview_origin', 'Preview access is only available on the preview origin', 404);
    const token = c.req.param('token');
    const projectId = parseUuid(c.req.query('project') ?? '', 'project id');
    if (!database.getPreviewSession(hashToken(token), projectId)) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403);
    setCookie(c, 'vibelog_preview', token, { httpOnly: true, secure: config.previewOrigin.startsWith('https://'), sameSite: 'Lax', path: `/preview/${projectId}`, maxAge: 300 });
    return c.redirect(`/preview/${projectId}/`);
  });
  app.get('/preview/:projectId/*', async (c) => {
    if (new URL(c.req.url).origin !== config.previewOrigin) throw new AppError('wrong_preview_origin', 'Preview is only available on the preview origin', 404);
    const projectId = parseUuid(c.req.param('projectId'), 'project id');
    const token = getCookie(c, 'vibelog_preview');
    const session = token ? database.getPreviewSession(hashToken(token), projectId) : null;
    if (!session) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403);
    const root = join(projectRoot(config.dataRoot, session.userId, projectId), 'dist');
    const rawPath = c.req.path.slice(`/preview/${projectId}/`.length);
    if (/%(?:2f|5c|2e)/i.test(rawPath)) throw new AppError('unsafe_preview_path', 'Unsafe preview path', 400);
    let target = resolveRelativeWithin(root, decodeURIComponent(rawPath || 'index.html'));
    const targetStat = await stat(target).catch(() => null);
    if (targetStat?.isDirectory()) target = join(target, 'index.html');
    await assertNoSymlinkEscape(root, target).catch(() => { throw new AppError('preview_not_found', 'Preview file not found', 404); });
    c.header('Content-Type', contentType(basename(target)));
    c.header('Content-Security-Policy', `default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors ${config.appOrigin}`);
    c.header('Cache-Control', 'private, no-store');
    return new Response(new Uint8Array(await readFile(target)), { headers: c.res.headers });
  });

  return { app, database, config };
}
