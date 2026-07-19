import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { renderThemeCss } from '@vibelog/core';
import { createAuth, readSession, type AppVariables } from './auth.js';
import { CLIENT_SCRIPT } from './client.js';
import { loadAppConfig, type AppConfig } from './config.js';
import { AiQuotaExceededError, AppDatabase, type BlogRecord, type OperationType } from './database.js';
import { AppError, assertCsrfToken, assertMutationOrigin, jsonError, requestContext } from './http.js';
import { hashToken, randomToken } from './security/crypto.js';
import { assertNoSymlinkEscape, resolveRelativeWithin } from './security/path.js';
import { operationMessage } from './operation-status.js';
import { themeFromControls } from './theme-studio.js';
import { changePasswordPage, editorPage, loginPage, onboardingPage, operationPage, registerPage } from './views.js';

const RESERVED = new Set(['preview', 'www', 'api', 'admin', 'assets']);
const registerInput = z.object({ inviteCode: z.string().min(1).max(512), username: z.string().trim().min(3).max(32).regex(/^[a-z0-9_-]+$/i), password: z.string().min(12).max(128) });
const loginInput = z.object({ username: z.string().trim().min(3).max(32), password: z.string().min(1).max(128) });
const changePasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) });
const hackmdInput = z.object({ hackmdUsername: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u) });
const themeInput = z.object({ prompt: z.string().trim().min(1).max(1000) });
const previewTokenInput = z.string().min(32).max(512);
const uuidInput = z.uuid();

interface AppEnv { Variables: AppVariables }
type AppContext = Context<AppEnv>;
interface CreateAppOptions { config?: AppConfig; database?: AppDatabase }
const formValue = (body: Record<string, string | File>, key: string) => typeof body[key] === 'string' ? body[key] : undefined;
function hostName(c: AppContext): string { try { return new URL(`http://${c.req.header('host') ?? ''}`).hostname.toLowerCase(); } catch { return ''; } }
function publicUsername(c: AppContext, config: AppConfig): string | null { const suffix = `.${config.appHostname}`; const host = hostName(c); if (!host.endsWith(suffix)) return null; const label = host.slice(0, -suffix.length); return /^[a-z0-9_-]{3,32}$/.test(label) && !RESERVED.has(label) ? label : null; }
function contentType(path: string): string { const extension = path.split('.').at(-1)?.toLowerCase(); return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'; }
function cookieValue(header: string | undefined, name: string): string | undefined { return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function siteUrl(config: AppConfig, username: string): string { const origin = new URL(config.appOrigin); return `${origin.protocol}//${username}.${origin.hostname}${origin.port ? `:${origin.port}` : ''}`; }


async function staticResponse(c: AppContext, root: string, requestPath: string, cache: string): Promise<Response> {
  if (/%(?:2f|5c|2e)/i.test(requestPath)) throw new AppError('unsafe_path', 'Unsafe path', 400);
  const relative = decodeURIComponent(requestPath.replace(/^\/+/, '') || 'index.html');
  let target = resolveRelativeWithin(root, relative);
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) target = join(target, 'index.html');
  await assertNoSymlinkEscape(root, target).catch(() => { throw new AppError('site_not_found', 'Page not found', 404); });
  c.header('Content-Type', contentType(basename(target)));
  c.header('Cache-Control', cache);
  return new Response(new Uint8Array(await readFile(target)), { headers: c.res.headers });
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadAppConfig();
  const database = options.database ?? new AppDatabase(config.dataRoot);
  const auth = createAuth(database, config);
  const app = new Hono<AppEnv>();
  app.use('*', requestContext());
  app.onError((error, c) => jsonError(c, error));
  app.notFound((c) => jsonError(c, new AppError('not_found', 'Page not found', 404)));
  app.get('/health', (c) => c.json({ status: 'ok', service: 'vibelog' }));

  app.use('*', async (c, next) => {
    const host = hostName(c);
    if (host === config.appHostname) return next();
    if (host === new URL(config.previewOrigin).hostname) {
      if (c.req.path.startsWith('/preview-access/')) return next();
      const token = cookieValue(c.req.header('cookie'), 'vibelog_preview');
      const preview = token ? database.getPreviewSession(hashToken(token)) : null;
      if (!preview) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403);
      const blog = database.getBlog(preview.blogId);
      if (!blog?.draftArtifact) throw new AppError('preview_not_ready', 'Preview is not ready', 404);
      c.header('Content-Security-Policy', `default-src 'self'; script-src 'none'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors ${config.appOrigin}`);
      if (c.req.path === '/theme.css') {
        const theme = database.getActiveTheme(blog.id);
        if (!theme) throw new AppError('theme_not_found', 'Theme not found', 404);
        c.header('Content-Type', 'text/css; charset=utf-8'); c.header('Cache-Control', 'private, no-store');
        return c.body(renderThemeCss(preview.themeConfig ?? theme.config));
      }
      return staticResponse(c, blog.draftArtifact, c.req.path, 'private, no-store');
    }
    const username = publicUsername(c, config);
    if (username) {
      const blog = database.getBlogByUsername(username);
      const release = blog ? database.getActiveRelease(blog.id) : null;
      if (!release) throw new AppError('site_not_found', 'This blog has not been published yet', 404);
      c.header('Content-Security-Policy', "default-src 'self'; script-src 'none'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return staticResponse(c, release.artifact, c.req.path, 'public, max-age=60');
    }
    throw new AppError('unknown_host', 'Unknown VibeLog host', 404);
  });
  app.use('*', async (c, next) => { await next(); if (c.res.headers.get('content-type')?.includes('text/html')) c.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'nonce-${c.get('cspNonce')}'; img-src 'self' data:; connect-src 'self'; frame-src ${config.previewOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`); });

  app.get('/assets/client.js', (c) => { c.header('Content-Type', 'text/javascript; charset=utf-8'); c.header('Cache-Control', 'no-store'); return c.body(CLIENT_SCRIPT); });
  const internalAuthPost = async (c: AppContext, path: string, body: Record<string, unknown>) => {
    const headers = new Headers({ 'content-type': 'application/json', origin: config.appOrigin });
    const cookie = c.req.header('cookie'); if (cookie) headers.set('cookie', cookie);
    const ip = c.req.header('x-forwarded-for'); if (ip) headers.set('x-forwarded-for', ip);
    return auth.handler(new Request(new URL(`/api/auth${path}`, config.appOrigin), { method: 'POST', headers, body: JSON.stringify(body) }));
  };
  const copyCookies = (c: AppContext, response: Response) => { for (const cookie of response.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true }); };

  app.get('/auth/login', async (c) => await readSession(c, auth, config) ? c.redirect('/editor') : c.html(loginPage(c.get('cspNonce'))));
  app.post('/auth/login', async (c) => {
    assertMutationOrigin(c, config); const body = await c.req.parseBody().catch(() => ({}));
    const input = loginInput.safeParse({ username: formValue(body, 'username'), password: formValue(body, 'password') });
    if (!input.success) return c.html(loginPage(c.get('cspNonce'), 'Username 或密碼錯誤'), 401);
    const response = await internalAuthPost(c, '/sign-in/username', { username: input.data.username.toLowerCase(), password: input.data.password });
    if (!response.ok) return c.html(loginPage(c.get('cspNonce'), response.status === 429 ? '嘗試次數過多，請稍後再試' : 'Username 或密碼錯誤'), response.status === 429 ? 429 : 401);
    copyCookies(c, response); return c.redirect('/editor', 303);
  });
  app.get('/auth/register', async (c) => await readSession(c, auth, config) ? c.redirect('/editor') : c.html(registerPage(c.get('cspNonce'))));
  app.post('/auth/register', async (c) => {
    assertMutationOrigin(c, config); const body = await c.req.parseBody().catch(() => ({}));
    const input = registerInput.safeParse({ inviteCode: formValue(body, 'inviteCode'), username: formValue(body, 'username'), password: formValue(body, 'password') });
    if (!input.success) return c.html(registerPage(c.get('cspNonce'), '請檢查邀請碼、username 與密碼格式'), 400);
    const username = input.data.username.toLowerCase();
    if (RESERVED.has(username)) return c.html(registerPage(c.get('cspNonce'), '這個 username 無法使用'), 400);
    const ip = ((c.req.header('x-forwarded-for') ?? 'unknown').split(',')[0] ?? 'unknown').trim();
    if (!database.consumeInviteAttempt(ip)) return c.html(registerPage(c.get('cspNonce'), '嘗試次數過多，請稍後再試'), 429);
    const digest = createHash('sha256').update(input.data.inviteCode).digest();
    if (!timingSafeEqual(digest, config.betaInviteDigest)) return c.html(registerPage(c.get('cspNonce'), '邀請碼無效'), 401);
    const response = await internalAuthPost(c, '/sign-up/email', { email: `${username}@users.vibelog.invalid`, username, displayUsername: username, name: username, password: input.data.password });
    if (!response.ok) return c.html(registerPage(c.get('cspNonce'), response.status === 429 ? '嘗試次數過多，請稍後再試' : '這個 username 無法使用'), response.status === 429 ? 429 : 400);
    copyCookies(c, response); return c.redirect('/onboarding', 303);
  });

  const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => { const session = await readSession(c, auth, config); if (!session) return c.redirect('/auth/login'); c.set('session', session); await next(); };
  app.use('/editor', requireSession); app.use('/onboarding', requireSession); app.use('/operations/*', requireSession); app.use('/actions/*', requireSession); app.use('/api/*', requireSession); app.use('/auth/change-password', requireSession); app.use('/auth/logout', requireSession);
  app.post('/auth/logout', async (c) => { const body = await c.req.parseBody(); assertMutationOrigin(c, config); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); const response = await internalAuthPost(c, '/sign-out', {}); copyCookies(c, response); return c.redirect('/auth/login', 303); });
  app.get('/auth/change-password', (c) => c.html(changePasswordPage(c.get('cspNonce'), c.get('session'))));
  app.post('/auth/change-password', async (c) => { const body = await c.req.parseBody(); assertMutationOrigin(c, config); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); const input = changePasswordInput.safeParse({ currentPassword: formValue(body, 'currentPassword'), newPassword: formValue(body, 'newPassword') }); if (!input.success) throw new AppError('invalid_password', '新密碼必須是 12–128 字元', 400); const response = await internalAuthPost(c, '/change-password', { ...input.data, revokeOtherSessions: true }); if (!response.ok) throw new AppError('password_change_failed', response.status === 429 ? '嘗試次數過多，請稍後再試' : '目前密碼錯誤', response.status === 429 ? 429 : 400); copyCookies(c, response); return c.redirect('/editor', 303); });

  app.get('/', async (c) => c.redirect(await readSession(c, auth, config) ? '/editor' : '/auth/login'));
  app.get('/onboarding', (c) => {
    const blog = database.getBlogForUser(c.get('session').user.id);
    if (blog?.draftArtifact) return c.redirect('/editor');
    const operation = blog ? database.getActiveOperation(blog.id, blog.userId) : null;
    return c.html(onboardingPage(c.get('cspNonce'), c.get('session'), blog, operation));
  });

  function ownedBlog(c: AppContext): BlogRecord { const blog = database.getBlogForUser(c.get('session').user.id); if (!blog) throw new AppError('blog_not_found', '請先連接 HackMD', 404); return blog; }
  function redirectOrJson(c: AppContext, operationId: string) { const operationUrl = `/operations/${operationId}`; return c.req.header('accept')?.includes('application/json') ? c.json({ operationUrl, pollUrl: `/api/operations/${operationId}` }, 202) : c.redirect(operationUrl, 303); }
  async function mutationBody(c: AppContext) { assertMutationOrigin(c, config); const body = await c.req.parseBody(); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); return body; }
  function enqueue(c: AppContext, type: OperationType, payload: Record<string, unknown> = {}) {
    const blog = ownedBlog(c);
    try {
      const operation = type === 'generate_theme' ? database.createThemeOperation(
        blog.userId,
        blog.id,
        String(payload.prompt),
        payload.baseTheme,
        { userDailyLimit: config.aiUserDailyLimit, globalDailyLimit: config.aiGlobalDailyLimit },
      ) : type === 'publish'
        ? database.createPublishOperation(blog.userId, blog.id, hashToken(String(payload.previewToken)))
        : database.createOperation(blog.userId, blog.id, type, payload);
      return redirectOrJson(c, operation.id);
    } catch (error) {
      if (error instanceof AiQuotaExceededError) throw new AppError('ai_quota_exceeded', '今天的 AI 樣式額度已用完', 429, { 'Retry-After': String(error.retryAfter) });
      if (error instanceof Error && error.message === 'Nothing to publish') throw new AppError('nothing_to_publish', '目前沒有需要發布的變更', 409);
      if (error instanceof Error && error.message === 'Blog has no synced content') throw new AppError('preview_not_ready', '請先完成內容同步', 409);
      if (error instanceof Error && error.message === 'Preview has unsaved theme changes') throw new AppError('unsaved_theme', '請先儲存目前的樣式，再進行發布', 409);
      if (error instanceof Error && error.message === 'Preview session expired or invalid') throw new AppError('preview_session_expired', '預覽已過期，請重新整理編輯器', 409);
      if (error instanceof Error && (error.message.includes('UNIQUE constraint') || error.message.includes('active operation'))) throw new AppError('operation_in_progress', '目前已有操作進行中', 409);
      throw error;
    }
  }

  app.post('/actions/blog/connect', async (c) => {
    const body = await mutationBody(c);
    const input = hackmdInput.safeParse({ hackmdUsername: formValue(body, 'hackmdUsername') });
    if (!input.success) throw new AppError('invalid_hackmd_username', 'HackMD username 格式錯誤', 400);
    const session = c.get('session');
    const blog = database.getBlogForUser(session.user.id);
    if (blog?.draftArtifact) throw new AppError('source_locked', '內容首次同步成功後不能更換 HackMD 來源', 409);
    try {
      const operation = blog ? database.retryInitialSync(session.user.id, input.data.hackmdUsername) : database.createBlog(session.user.id, session.user.username, input.data.hackmdUsername).operation;
      return redirectOrJson(c, operation.id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('active operation')) throw new AppError('operation_in_progress', '目前正在同步，請稍候', 409);
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) throw new AppError('blog_unavailable', '無法建立 blog', 409);
      throw error;
    }
  });
  app.post('/actions/blog/sync', async (c) => { await mutationBody(c); return enqueue(c, 'sync'); });
  function themeFromBody(c: AppContext, body: Record<string, string | File>) {
    const blog = ownedBlog(c);
    const activeTheme = database.getActiveTheme(blog.id);
    if (!activeTheme) throw new AppError('theme_not_found', 'Theme not found', 404);
    try { return { blog, theme: themeFromControls(activeTheme.config, body) }; }
    catch { throw new AppError('invalid_theme_controls', '樣式選項無效，請重新整理後再試一次', 400); }
  }
  function readPreviewToken(body: Record<string, string | File>): string {
    const token = previewTokenInput.safeParse(formValue(body, 'previewToken'));
    if (!token.success) throw new AppError('preview_session_expired', '預覽已過期，請重新整理編輯器', 409);
    return token.data;
  }
  function assertOwnedPreview(blog: BlogRecord, token: string): void {
    const preview = database.getPreviewSession(hashToken(token));
    if (!preview || preview.userId !== blog.userId || preview.blogId !== blog.id) throw new AppError('preview_session_expired', '預覽已過期，請重新整理編輯器', 409);
  }
  app.post('/api/theme/preview', async (c) => {
    const body = await mutationBody(c);
    const token = readPreviewToken(body);
    const { blog, theme } = themeFromBody(c, body);
    try { database.updatePreviewTheme(hashToken(token), blog.userId, blog.id, theme); }
    catch (error) { if (error instanceof Error && error.message === 'Preview session expired or invalid') throw new AppError('preview_session_expired', '預覽已過期，請重新整理編輯器', 409); throw error; }
    return c.json({ status: 'succeeded', message: '預覽已更新，尚未儲存' });
  });
  app.post('/actions/theme/apply', async (c) => {
    const body = await mutationBody(c);
    const { blog, theme } = themeFromBody(c, body);
    assertOwnedPreview(blog, readPreviewToken(body));
    try { database.createManualTheme(blog.userId, blog.id, theme); }
    catch (error) { if (error instanceof Error && error.message.includes('active operation')) throw new AppError('operation_in_progress', '目前已有操作進行中', 409); throw error; }
    return c.redirect('/editor', 303);
  });
  app.post('/actions/theme/generate', async (c) => { const body = await mutationBody(c); const input = themeInput.safeParse({ prompt: formValue(body, 'prompt') }); if (!input.success) throw new AppError('invalid_theme_prompt', '請用 1–1000 字描述想要的樣式', 400); const { blog, theme } = themeFromBody(c, body); assertOwnedPreview(blog, readPreviewToken(body)); return enqueue(c, 'generate_theme', { ...input.data, baseTheme: theme }); });
  app.post('/actions/theme/:id/activate', async (c) => { await mutationBody(c); const blog = ownedBlog(c); const id = uuidInput.safeParse(c.req.param('id')); if (!id.success) throw new AppError('invalid_revision', '樣式版本不存在', 404); try { database.activateTheme(id.data, blog.id); } catch (error) { if (error instanceof Error && error.message.includes('active operation')) throw new AppError('operation_in_progress', '目前已有操作進行中', 409); throw error; } return c.redirect('/editor', 303); });
  app.post('/actions/publish', async (c) => { const body = await mutationBody(c); return enqueue(c, 'publish', { previewToken: readPreviewToken(body) }); });

  app.get('/editor', (c) => {
    const blog = database.getBlogForUser(c.get('session').user.id);
    if (!blog?.draftArtifact) return c.redirect('/onboarding');
    const themes = database.listThemes(blog.id);
    const activeTheme = themes.find((theme) => theme.active);
    if (!activeTheme) throw new AppError('theme_not_found', 'Theme not found', 404);
    const token = randomToken();
    database.createPreviewSession(hashToken(token), blog.userId, blog.id, new Date(Date.now() + 15 * 60_000).toISOString(), activeTheme.config);
    const previewUrl = `${config.previewOrigin}/preview-access/${encodeURIComponent(token)}`;
    const published = database.getActiveRelease(blog.id);
    const operation = database.getActiveOperation(blog.id, blog.userId);
    return c.html(editorPage({ nonce: c.get('cspNonce'), session: c.get('session'), blog, themes, activeTheme, published, previewUrl, previewToken: token, publicUrl: siteUrl(config, blog.username), appHostname: config.appHostname, operation }));
  });
  app.get('/operations/:id', (c) => {
    const id = uuidInput.safeParse(c.req.param('id'));
    const operation = id.success ? database.getOperation(id.data, c.get('session').user.id) : null;
    if (!operation) throw new AppError('operation_not_found', '操作不存在', 404);
    const blog = database.getBlog(operation.blogId);
    return c.html(operationPage(c.get('cspNonce'), c.get('session'), operation, blog?.draftArtifact ? '/editor' : '/onboarding'));
  });
  app.get('/api/session', (c) => c.json({ user: c.get('session').user, csrfToken: c.get('session').csrfToken }));
  app.get('/api/operations/:id', (c) => {
    const id = uuidInput.safeParse(c.req.param('id'));
    const operation = id.success ? database.getOperation(id.data, c.get('session').user.id) : null;
    if (!operation) throw new AppError('operation_not_found', '操作不存在', 404);
    return c.json({ status: operation.status, message: operationMessage(operation) });
  });

  app.get('/preview-access/:token', (c) => { const preview = database.getPreviewSession(hashToken(c.req.param('token'))); if (!preview) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403); setCookie(c, 'vibelog_preview', c.req.param('token'), { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', maxAge: 900 }); return c.redirect('/'); });
  return { app, auth, database, config };
}
