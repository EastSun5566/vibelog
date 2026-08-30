import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { renderThemeCss } from '@vibelog/core';
import { createAuth, readSession, type AppVariables } from './auth.js';
import { blogIdentitySchema, blogLanguageSchema } from './blog-sync.js';
import { CLIENT_SCRIPT } from './client.js';
import { loadAppConfig, type AppConfig } from './config.js';
import { AiQuotaExceededError, AppDatabase, type BlogRecord, type OperationRecord, type OperationType } from './database.js';
import { AppError, assertCsrfToken, assertMutationOrigin, jsonError, requestContext } from './http.js';
import type { OperationDispatcher } from './ports/operation-queue.js';
import { operationMessage, operationProgress } from './operation-status.js';
import type { ArtifactStore, StoredObject } from './ports/artifact-store.js';
import type { TransactionalEmailSender } from './ports/transactional-email.js';
import { editorUrlWithPreviewPath, safePreviewPath } from './preview-path.js';
import { hashToken, randomToken } from './security/crypto.js';
import { themeFromControls } from './theme-studio.js';
import { editorPage, guidePage, landingPage, loginPage, onboardingPage, operationPage } from './views.js';

const RESERVED = new Set(['preview', 'www', 'api', 'admin', 'assets']);
const handleInput = z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/);
const emailInput = z.email().max(320);
const hackmdInput = z.object({ hackmdUsername: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u) });
const themeInput = z.object({ prompt: z.string().trim().min(1).max(1000) });
const previewTokenInput = z.string().min(32).max(512);
const uuidInput = z.uuid();
interface AppEnv { Variables: AppVariables }
type AppContext = Context<AppEnv>;
interface CreateAppOptions { config?: AppConfig; database?: AppDatabase; artifactStore: ArtifactStore; emailSender: TransactionalEmailSender; dispatcher: OperationDispatcher }
const formValue = (body: Record<string, string | File>, key: string) => typeof body[key] === 'string' ? body[key] : undefined;
function hostName(c: AppContext): string { try { return new URL(`http://${c.get('edgeHost') ?? c.req.header('host') ?? ''}`).hostname.toLowerCase(); } catch { return ''; } }
function publicUsername(c: AppContext, config: AppConfig): string | null { const suffix = `.${config.appHostname}`; const host = hostName(c); if (!host.endsWith(suffix)) return null; const label = host.slice(0, -suffix.length); return /^[a-z0-9-]{3,32}$/.test(label) && !RESERVED.has(label) ? label : null; }
function cookieValue(header: string | undefined, name: string): string | undefined { return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function siteUrl(config: AppConfig, username: string): string { const origin = new URL(config.appOrigin); return `${origin.protocol}//${username}.${origin.hostname}${origin.port ? `:${origin.port}` : ''}`; }
function releaseEtag(releaseId: string, requestPath: string): string { return `"${createHash('sha256').update(releaseId).update('\0').update(requestPath).digest('base64url')}"`; }
function matchesEtag(value: string | undefined, etag: string): boolean { return value?.split(',').some((candidate) => { const tag = candidate.trim(); return tag === '*' || tag === etag || tag === `W/${etag}`; }) ?? false; }
function contentType(path: string): string { const extension = path.split('.').at(-1)?.toLowerCase(); return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'; }
function safeObjectPath(requestPath: string): string {
  if (/%(?:2f|5c|2e)/i.test(requestPath)) throw new AppError('unsafe_path', 'Unsafe path', 400);
  const path = decodeURIComponent(requestPath.replace(/^\/+/, '') || 'index.html').replaceAll('\\', '/');
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) throw new AppError('unsafe_path', 'Unsafe path', 400);
  return path;
}
async function findObject(store: ArtifactStore, artifactId: string, requestPath: string): Promise<{ path: string; object: StoredObject } | null> {
  const path = safeObjectPath(requestPath); const direct = await store.readObject(artifactId, path); if (direct) return { path, object: direct };
  const index = await store.readObject(artifactId, `${path.replace(/\/$/, '')}/index.html`); return index ? { path: `${path}/index.html`, object: index } : null;
}
async function artifactResponse(c: AppContext, store: ArtifactStore, artifactId: string, requestPath: string, cache: string, etag?: string, transformHtml?: (html: string) => string): Promise<Response> {
  const found = await findObject(store, artifactId, requestPath); if (!found) throw new AppError('site_not_found', 'Page not found', 404);
  const type = found.object.contentType ?? contentType(found.path); c.header('Content-Type', type); c.header('Cache-Control', cache);
  if (etag) { c.header('ETag', etag); if (matchesEtag(c.req.header('if-none-match'), etag)) return new Response(null, { status: 304, headers: c.res.headers }); }
  if (transformHtml && type.startsWith('text/html')) return new Response(transformHtml(await new Response(found.object.body).text()), { headers: c.res.headers });
  return new Response(found.object.body, { headers: c.res.headers });
}
function previewBridge(appOrigin: string, nonce: string): string { const parentOrigin = JSON.stringify(new URL(appOrigin).origin).replaceAll('<', '\\u003c'); return `<script nonce="${nonce}">(()=>{const parentOrigin=${parentOrigin};const report=()=>parent.postMessage({type:'vibelog-preview-location',path:location.pathname+location.search+location.hash},parentOrigin);addEventListener('hashchange',report);addEventListener('message',(event)=>{if(event.origin!==parentOrigin||event.source!==parent||event.data?.type!=='vibelog-preview-refresh')return;location.reload()});report()})()</script>`; }
function injectPreviewBridge(html: string, script: string): string { return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`; }

export function createApp(options: CreateAppOptions) {
  const config = options.config ?? loadAppConfig(); const database = options.database ?? new AppDatabase(config.databaseUrl);
  const auth = createAuth(database, config, options.emailSender); const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.use('*', async (c, next) => {
    const edgeHost = c.req.header('x-vibelog-host'); if (!edgeHost) return next();
    const timestamp = c.req.header('x-vibelog-timestamp'); const signature = c.req.header('x-vibelog-signature');
    if (!config.edgeSharedSecret || !timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new AppError('edge_identity_invalid', 'Invalid edge identity', 401);
    const url = new URL(c.req.url); const expected = createHmac('sha256', config.edgeSharedSecret).update(`${timestamp}\n${edgeHost}\n${url.pathname}${url.search}`).digest('base64url');
    const left = Buffer.from(signature); const right = Buffer.from(expected); if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AppError('edge_identity_invalid', 'Invalid edge identity', 401);
    c.set('edgeHost', edgeHost); return next();
  });
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => Response.json({ error: { code: 'payload_too_large', message: 'Request body exceeds 64 KiB', requestId: randomUUID() } }, { status: 413 }) }));
  app.onError((error, c) => jsonError(c, error)); app.notFound((c) => jsonError(c, new AppError('not_found', 'Page not found', 404)));
  app.get('/health', async (c) => { await database.ping(); return c.json({ status: 'ok', service: 'vibelog' }); });
  app.use('*', async (c, next) => {
    const host = hostName(c); if (host === config.appHostname) return next();
    if (host === new URL(config.previewOrigin).hostname) {
      if (c.req.path.startsWith('/preview-access/')) return next();
      const token = cookieValue(c.req.header('cookie'), 'vibelog_preview'); const preview = token ? await database.getPreviewSession(hashToken(token)) : null;
      if (!preview) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403);
      const blog = await database.getBlog(preview.blogId); if (!blog?.draftArtifactId) throw new AppError('preview_not_ready', 'Preview is not ready', 404);
      if (c.req.path === '/theme.css') {
        c.header('Content-Security-Policy', `default-src 'self'; script-src 'none'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors ${config.appOrigin}`);
        const theme = await database.getActiveTheme(blog.id); if (!theme) throw new AppError('theme_not_found', 'Theme not found', 404);
        c.header('Content-Type', 'text/css; charset=utf-8'); c.header('Cache-Control', 'private, no-store'); return c.body(renderThemeCss(preview.themeConfig ?? theme.config));
      }
      const nonce = randomBytes(18).toString('base64'); c.header('Content-Security-Policy', `default-src 'self'; script-src 'nonce-${nonce}'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors ${config.appOrigin}`);
      return artifactResponse(c, options.artifactStore, blog.draftArtifactId, c.req.path, 'private, no-store', undefined, (html) => injectPreviewBridge(html, previewBridge(config.appOrigin, nonce)));
    }
    const username = publicUsername(c, config);
    if (username) {
      const blog = await database.getBlogByUsername(username); const release = blog ? await database.getActiveRelease(blog.id) : null;
      if (!release) throw new AppError('site_not_found', 'This blog has not been published yet', 404);
      c.header('Content-Security-Policy', "default-src 'self'; script-src 'none'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return artifactResponse(c, options.artifactStore, release.artifactId, c.req.path, 'public, no-cache', releaseEtag(release.id, c.req.path));
    }
    throw new AppError('unknown_host', 'Unknown VibeLog host', 404);
  });
  app.use('*', async (c, next) => { await next(); if (c.res.headers.get('content-type')?.includes('text/html')) c.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${config.previewOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`); });
  app.get('/assets/client.js', (c) => { c.header('Content-Type', 'text/javascript; charset=utf-8'); c.header('Cache-Control', 'no-store'); return c.body(CLIENT_SCRIPT); });
  app.get('/assets/app.css', async (c) => { c.header('Content-Type', 'text/css; charset=utf-8'); c.header('Cache-Control', 'no-cache'); return c.body(new Uint8Array(await readFile(new URL('../dist/assets/app.css', import.meta.url)))); });
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  const internalAuthPost = async (c: AppContext, path: string, body: Record<string, unknown>) => { const headers = new Headers({ 'content-type': 'application/json', origin: config.appOrigin }); const cookie = c.req.header('cookie'); if (cookie) headers.set('cookie', cookie); return auth.handler(new Request(new URL(`/api/auth${path}`, config.appOrigin), { method: 'POST', headers, body: JSON.stringify(body) })); };
  const copyCookies = (c: AppContext, response: Response) => { for (const cookie of response.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true }); };

  app.get('/auth/login', async (c) => await readSession(c, auth, config) ? c.redirect('/editor') : c.html(loginPage({ github: Boolean(config.githubClientId), google: Boolean(config.googleClientId) })));
  app.post('/auth/magic-link', async (c) => {
    assertMutationOrigin(c, config); const body = await c.req.parseBody().catch(() => ({})); const parsed = emailInput.safeParse(formValue(body, 'email')?.trim().toLowerCase());
    if (!parsed.success) return c.html(loginPage({ github: Boolean(config.githubClientId), google: Boolean(config.googleClientId), message: 'Enter a valid email address.' }), 400);
    const key = createHmacKey(config.betterAuthSecret, parsed.data);
    if (!await database.consumeRateLimit(`magic:minute:${key}`, 1, 60) || !await database.consumeRateLimit(`magic:hour:${key}`, 3, 3600)) return c.html(loginPage({ github: Boolean(config.githubClientId), google: Boolean(config.googleClientId), message: 'Please wait before requesting another link.' }), 429);
    const response = await internalAuthPost(c, '/sign-in/magic-link', { email: parsed.data, name: parsed.data.split('@')[0], callbackURL: '/editor' });
    if (!response.ok) throw new AppError('magic_link_failed', 'Could not send a sign-in link.', 502);
    return c.html(loginPage({ github: Boolean(config.githubClientId), google: Boolean(config.googleClientId), sent: true }));
  });
  app.post('/auth/oauth/:provider', async (c) => {
    assertMutationOrigin(c, config); const provider = c.req.param('provider');
    if ((provider !== 'github' || !config.githubClientId) && (provider !== 'google' || !config.googleClientId)) throw new AppError('oauth_unavailable', 'OAuth provider is unavailable.', 404);
    const response = await internalAuthPost(c, '/sign-in/social', { provider, callbackURL: '/editor' }); copyCookies(c, response);
    const data = await response.json().catch(() => null) as { url?: string } | null; if (!response.ok || !data?.url) throw new AppError('oauth_failed', 'Could not start OAuth sign-in.', 502); return c.redirect(data.url);
  });
  const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => { const session = await readSession(c, auth, config); if (!session) return c.redirect('/auth/login'); c.set('session', session); await next(); };
  for (const path of ['/editor', '/onboarding', '/operations/*', '/actions/*', '/api/*', '/auth/logout']) app.use(path, requireSession);
  app.post('/auth/logout', async (c) => { const body = await c.req.parseBody(); assertMutationOrigin(c, config); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); const response = await internalAuthPost(c, '/sign-out', {}); copyCookies(c, response); return c.redirect('/auth/login', 303); });
  app.get('/', async (c) => await readSession(c, auth, config) ? c.redirect('/editor') : c.html(landingPage()));
  app.get('/guide', async (c) => c.html(guidePage((await readSession(c, auth, config)) ?? undefined)));
  app.get('/onboarding', async (c) => { const blog = await database.getBlogForUser(c.get('session').user.id); if (blog?.draftArtifactId) return c.redirect('/editor'); const operation = blog ? await database.getActiveOperation(blog.id, blog.userId) : null; return c.html(onboardingPage(c.get('session'), blog, operation)); });

  async function ownedBlog(c: AppContext): Promise<BlogRecord> { const blog = await database.getBlogForUser(c.get('session').user.id); if (!blog) throw new AppError('blog_not_found', 'Connect HackMD first.', 404); return blog; }
  function redirectOrJson(c: AppContext, operationId: string, successUrl = '/editor') { const operationUrl = `/operations/${operationId}`; return c.req.header('accept')?.includes('application/json') ? c.json({ operationUrl, pollUrl: `/api/operations/${operationId}`, successUrl }, 202) : c.redirect(operationUrl, 303); }
  async function mutationBody(c: AppContext) { assertMutationOrigin(c, config); const body = await c.req.parseBody(); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); return body; }
  async function dispatchAndRedirect(c: AppContext, operation: OperationRecord, successUrl = '/editor') {
    await options.dispatcher.dispatch().catch((error: unknown) => { console.error(`[operation:${operation.id}] immediate dispatch failed; outbox will retry`, error); });
    return redirectOrJson(c, operation.id, successUrl);
  }
  async function enqueue(c: AppContext, type: OperationType, payload: Record<string, unknown> = {}) {
    const blog = await ownedBlog(c); const previewPath = typeof payload.previewPath === 'string' ? payload.previewPath : '/';
    try {
      const operation = type === 'generate_theme' ? await database.createThemeOperation(blog.userId, blog.id, String(payload.prompt), payload.baseTheme, { userDailyLimit: config.aiUserDailyLimit, globalDailyLimit: config.aiGlobalDailyLimit }, previewPath)
        : type === 'publish' ? await database.createPublishOperation(blog.userId, blog.id, hashToken(String(payload.previewToken))) : await database.createSyncOperation(blog.userId, blog.id, payload);
      return await dispatchAndRedirect(c, operation, type === 'generate_theme' ? editorUrlWithPreviewPath(previewPath) : '/editor');
    } catch (error) {
      if (error instanceof AiQuotaExceededError) throw new AppError('ai_quota_exceeded', 'Today’s AI theme quota is exhausted.', 429, { 'Retry-After': String(error.retryAfter) });
      const known: Record<string, [string, string, number]> = {
        'Nothing to publish': ['nothing_to_publish', 'There are no unpublished changes.', 409], 'Nothing to update': ['nothing_to_update', 'The blog details are unchanged.', 409],
        'Nothing to update article selection': ['nothing_to_update', 'The article selection is unchanged.', 409], 'No articles selected': ['no_articles_selected', 'Select at least one article.', 400],
        'Unknown article selection': ['invalid_article_selection', 'The article selection is stale. Refresh and try again.', 409], 'Article selection unavailable': ['article_selection_unavailable', 'Finish the first content sync.', 409],
        'Blog has no synced content': ['preview_not_ready', 'Finish the first content sync.', 409], 'Preview has unsaved theme changes': ['unsaved_theme', 'Save the theme before publishing.', 409],
        'Preview session expired or invalid': ['preview_session_expired', 'The preview expired. Refresh the editor.', 409],
      };
      if (error instanceof Error) {
        const knownError = known[error.message];
        if (knownError) { const [code, message, status] = knownError; throw new AppError(code, message, status === 400 ? 400 : 409); }
      }
      if (error instanceof Error && (error.message.includes('unique') || error.message.includes('active operation'))) throw new AppError('operation_in_progress', 'Another operation is already running.', 409);
      throw error;
    }
  }
  app.post('/actions/blog/connect', async (c) => {
    const body = await mutationBody(c); const input = z.object({ username: handleInput, hackmdUsername: hackmdInput.shape.hackmdUsername, language: blogLanguageSchema }).safeParse({ username: formValue(body, 'username'), hackmdUsername: formValue(body, 'hackmdUsername'), language: formValue(body, 'language') });
    if (!input.success || RESERVED.has(input.data.username)) throw new AppError('invalid_blog_source', 'Check the blog handle, HackMD username, and language.', 400);
    const session = c.get('session'); const blog = await database.getBlogForUser(session.user.id); if (blog?.draftArtifactId) throw new AppError('source_locked', 'The HackMD source cannot change after the first successful sync.', 409);
    const operation = blog ? await database.retryInitialSync(session.user.id, input.data.hackmdUsername, input.data.language) : (await database.createBlog(session.user.id, input.data.username, input.data.hackmdUsername, input.data.language)).operation;
    return dispatchAndRedirect(c, operation);
  });
  app.post('/actions/blog/sync', async (c) => { await mutationBody(c); return enqueue(c, 'sync', { intent: 'content' }); });
  app.post('/actions/blog/identity', async (c) => { const body = await mutationBody(c); const input = blogIdentitySchema.safeParse({ title: formValue(body, 'title'), description: formValue(body, 'description') ?? '', language: formValue(body, 'language') }); if (!input.success) throw new AppError('invalid_blog_identity', 'Check the blog details.', 400); return enqueue(c, 'sync', { intent: 'identity', site: input.data }); });
  app.post('/actions/blog/selection', async (c) => { const body = await mutationBody(c); const blog = await ownedBlog(c); if (!blog.contentManifest?.length) throw new AppError('article_selection_unavailable', 'Finish the first content sync.', 409); const included = new Set(Object.entries(body).filter(([name, value]) => name.startsWith('article:') && value === 'included').map(([name]) => name.slice(8))); const excludedSlugs = blog.contentManifest.filter((post) => !included.has(post.slug)).map((post) => post.slug); return enqueue(c, 'sync', { intent: 'selection', excludedSlugs }); });
  async function themeFromBody(c: AppContext, body: Record<string, string | File>) { const blog = await ownedBlog(c); const activeTheme = await database.getActiveTheme(blog.id); if (!activeTheme) throw new AppError('theme_not_found', 'Theme not found', 404); return { blog, theme: themeFromControls(activeTheme.config, body) }; }
  function readPreviewToken(body: Record<string, string | File>): string { const token = previewTokenInput.safeParse(formValue(body, 'previewToken')); if (!token.success) throw new AppError('preview_session_expired', 'The preview expired. Refresh the editor.', 409); return token.data; }
  async function assertOwnedPreview(blog: BlogRecord, token: string): Promise<void> { const preview = await database.getPreviewSession(hashToken(token)); if (!preview || preview.userId !== blog.userId || preview.blogId !== blog.id) throw new AppError('preview_session_expired', 'The preview expired. Refresh the editor.', 409); }
  app.post('/api/theme/preview', async (c) => { const body = await mutationBody(c); const token = readPreviewToken(body); const { blog, theme } = await themeFromBody(c, body); await database.updatePreviewTheme(hashToken(token), blog.userId, blog.id, theme); return c.json({ status: 'succeeded', message: 'Preview updated; changes are not saved' }); });
  app.post('/actions/theme/apply', async (c) => { const body = await mutationBody(c); const { blog, theme } = await themeFromBody(c, body); await assertOwnedPreview(blog, readPreviewToken(body)); await database.createManualTheme(blog.userId, blog.id, theme); return c.redirect(editorUrlWithPreviewPath(safePreviewPath(formValue(body, 'previewPath'), config.previewOrigin)), 303); });
  app.post('/actions/theme/generate', async (c) => { const body = await mutationBody(c); const input = themeInput.safeParse({ prompt: formValue(body, 'prompt') }); if (!input.success) throw new AppError('invalid_theme_prompt', 'Describe the theme in 1–1000 characters.', 400); const { blog, theme } = await themeFromBody(c, body); await assertOwnedPreview(blog, readPreviewToken(body)); const previewPath = safePreviewPath(formValue(body, 'previewPath'), config.previewOrigin); return enqueue(c, 'generate_theme', { ...input.data, baseTheme: theme, previewPath }); });
  app.post('/actions/theme/:id/activate', async (c) => { const body = await mutationBody(c); const blog = await ownedBlog(c); const id = uuidInput.parse(c.req.param('id')); await database.activateTheme(id, blog.id); return c.redirect(editorUrlWithPreviewPath(safePreviewPath(formValue(body, 'previewPath'), config.previewOrigin)), 303); });
  app.post('/actions/publish', async (c) => { const body = await mutationBody(c); return enqueue(c, 'publish', { previewToken: readPreviewToken(body) }); });
  app.post('/actions/releases/:id/activate', async (c) => { await mutationBody(c); const blog = await ownedBlog(c); const release = await database.getRelease(uuidInput.parse(c.req.param('id')), blog.id); if (!release || !(await database.getArtifact(release.artifactId))?.readyAt) throw new AppError('release_unavailable', 'This release artifact is unavailable.', 409); await database.activateExistingRelease(release.id, blog.id); return c.redirect('/editor', 303); });
  app.get('/editor', async (c) => {
    const blog = await database.getBlogForUser(c.get('session').user.id); if (!blog?.draftArtifactId) return c.redirect('/onboarding');
    const themes = await database.listThemes(blog.id); const activeTheme = themes.find((theme) => theme.active); if (!activeTheme) throw new AppError('theme_not_found', 'Theme not found', 404);
    const token = randomToken(); await database.createPreviewSession(hashToken(token), blog.userId, blog.id, new Date(Date.now() + 15 * 60_000).toISOString(), activeTheme.config);
    const previewPath = safePreviewPath(c.req.query('previewPath'), config.previewOrigin); const accessUrl = new URL(`/preview-access/${encodeURIComponent(token)}`, config.previewOrigin); if (previewPath !== '/') accessUrl.searchParams.set('returnTo', previewPath);
    const [published, releases, operation] = await Promise.all([database.getActiveRelease(blog.id), database.listReleases(blog.id), database.getActiveOperation(blog.id, blog.userId)]);
    return c.html(editorPage({ session: c.get('session'), blog, themes, activeTheme, published, releases, previewUrl: accessUrl.toString(), previewToken: token, previewOrigin: config.previewOrigin, previewPath, publicUrl: siteUrl(config, blog.username), appHostname: config.appHostname, operation }));
  });
  app.get('/operations/:id', async (c) => { const operation = await database.getOperation(uuidInput.parse(c.req.param('id')), c.get('session').user.id); if (!operation) throw new AppError('operation_not_found', 'Operation not found.', 404); const blog = await database.getBlog(operation.blogId); const previewPath = operation.type === 'generate_theme' ? safePreviewPath(operation.payload.previewPath, config.previewOrigin) : '/'; return c.html(operationPage(c.get('session'), operation, blog?.draftArtifactId ? '/editor' : '/onboarding', editorUrlWithPreviewPath(previewPath))); });
  app.get('/api/session', (c) => c.json({ user: c.get('session').user, csrfToken: c.get('session').csrfToken }));
  app.get('/api/operations/:id', async (c) => { const operation = await database.getOperation(uuidInput.parse(c.req.param('id')), c.get('session').user.id); if (!operation) throw new AppError('operation_not_found', 'Operation not found.', 404); return c.json({ status: operation.status, message: operationMessage(operation), progress: operationProgress(operation) }); });
  app.get('/preview-access/:token', async (c) => { const preview = await database.getPreviewSession(hashToken(c.req.param('token'))); if (!preview) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403); setCookie(c, 'vibelog_preview', c.req.param('token'), { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', maxAge: 900 }); return c.redirect(safePreviewPath(c.req.query('returnTo'), config.previewOrigin)); });
  return { app, auth, database, config };
}
function createHmacKey(secret: string, email: string): string { return createHash('sha256').update(secret).update('\0').update(email).digest('base64url'); }
