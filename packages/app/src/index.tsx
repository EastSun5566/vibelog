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

const RESERVED = new Set(['preview', 'www', 'api', 'admin', 'assets']);
const registerInput = z.object({ inviteCode: z.string().min(1).max(512), username: z.string().trim().min(3).max(32).regex(/^[a-z0-9_-]+$/i), password: z.string().min(12).max(128) });
const loginInput = z.object({ username: z.string().trim().min(3).max(32), password: z.string().min(1).max(128) });
const changePasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) });
const hackmdInput = z.object({ hackmdUsername: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u) });
const themeInput = z.object({ prompt: z.string().trim().min(1).max(1000) });
const uuidInput = z.uuid();
const styles = `:root{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#202124;background:#f6f5f2}*{box-sizing:border-box}body{margin:0}a{color:#075985}button,input,textarea{font:inherit}button{cursor:pointer}.shell{max-width:90rem;margin:auto;padding:1rem}.topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-block:.5rem 1rem}.topbar nav{display:flex;align-items:center;gap:.75rem}.button,button{border:1px solid #202124;border-radius:.45rem;background:#202124;color:#fff;padding:.65rem 1rem;text-decoration:none}.secondary{background:transparent;color:#202124}.stack{display:grid;gap:1rem}.card{background:#fff;border:1px solid #d8d5cd;border-radius:.75rem;padding:1rem}.editor{display:grid;grid-template-columns:minmax(18rem,25rem) minmax(0,1fr);gap:1rem;align-items:start}.controls{display:grid;gap:1rem}.preview{min-height:75vh;width:100%;border:1px solid #b8b4aa;border-radius:.75rem;background:#fff}.muted{color:#62605b}.error{color:#a12622}.status{min-height:1.5rem;border-left:4px solid #075985;padding:.5rem .75rem}.revision{display:flex;justify-content:space-between;gap:.75rem;align-items:center}form{display:grid;gap:.65rem}input,textarea{width:100%;padding:.65rem;border:1px solid #8a877f;border-radius:.4rem}textarea{min-height:7rem;resize:vertical}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}@media(max-width:52rem){.editor{grid-template-columns:1fr}.preview{min-height:65vh}}`;

interface AppEnv { Variables: AppVariables }
type AppContext = Context<AppEnv>;
interface CreateAppOptions { config?: AppConfig; database?: AppDatabase }
const formValue = (body: Record<string, string | File>, key: string) => typeof body[key] === 'string' ? body[key] : undefined;
function hostName(c: AppContext): string { try { return new URL(`http://${c.req.header('host') ?? ''}`).hostname.toLowerCase(); } catch { return ''; } }
function publicUsername(c: AppContext, config: AppConfig): string | null { const suffix = `.${config.appHostname}`; const host = hostName(c); if (!host.endsWith(suffix)) return null; const label = host.slice(0, -suffix.length); return /^[a-z0-9_-]{3,32}$/.test(label) && !RESERVED.has(label) ? label : null; }
function contentType(path: string): string { const extension = path.split('.').at(-1)?.toLowerCase(); return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'; }
function cookieValue(header: string | undefined, name: string): string | undefined { return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function siteUrl(config: AppConfig, username: string): string { const origin = new URL(config.appOrigin); return `${origin.protocol}//${username}.${origin.hostname}${origin.port ? `:${origin.port}` : ''}`; }

function document(title: string, content: unknown, nonce: string, session?: { csrfToken: string }, editor = false) {
  return <html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{title} · VibeLog</title><style nonce={nonce}>{styles}</style></head><body><div class="shell"><header class="topbar"><a href="/editor"><strong>VibeLog</strong></a>{session ? <nav aria-label="帳號"><a href="/auth/change-password">修改密碼</a><form method="post" action="/auth/logout"><input type="hidden" name="csrfToken" value={session.csrfToken}/><button class="secondary" type="submit">登出</button></form></nav> : null}</header><main>{content}</main></div>{editor ? <script type="module" src="/assets/client.js"></script> : null}</body></html>;
}
function loginPage(nonce: string, message?: string) { return document('登入', <section class="card stack"><h1>登入</h1>{message ? <p class="error" role="alert">{message}</p> : null}<form method="post" action="/auth/login"><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} autocomplete="username" autofocus/><label for="password">密碼</label><input id="password" name="password" type="password" required maxlength={128} autocomplete="current-password"/><button type="submit">登入</button></form><p><a href="/auth/register">使用邀請碼建立帳號</a></p></section>, nonce); }
function registerPage(nonce: string, message?: string) { return document('建立帳號', <section class="card stack"><h1>建立 VibeLog</h1><p class="muted">Beta 期間需要邀請碼。Username 也會成為你的網址，建立後無法修改。</p>{message ? <p class="error" role="alert">{message}</p> : null}<form method="post" action="/auth/register"><label for="inviteCode">Beta 邀請碼</label><input id="inviteCode" name="inviteCode" type="password" required autocomplete="off"/><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} pattern="[A-Za-z0-9_-]+" autocomplete="username"/><label for="password">密碼</label><input id="password" name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/><button type="submit">建立帳號</button></form><p><a href="/auth/login">返回登入</a></p></section>, nonce); }

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
        return c.body(renderThemeCss(theme.config));
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

  app.get('/assets/client.js', (c) => { c.header('Content-Type', 'text/javascript; charset=utf-8'); c.header('Cache-Control', 'public, max-age=3600'); return c.body(CLIENT_SCRIPT); });
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
  app.get('/auth/change-password', (c) => c.html(document('修改密碼', <section class="card stack"><h1>修改密碼</h1><form method="post" action="/auth/change-password"><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><label for="currentPassword">目前密碼</label><input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password"/><label for="newPassword">新密碼</label><input id="newPassword" name="newPassword" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/><button type="submit">更新密碼</button></form></section>, c.get('cspNonce'), c.get('session'))));
  app.post('/auth/change-password', async (c) => { const body = await c.req.parseBody(); assertMutationOrigin(c, config); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); const input = changePasswordInput.safeParse({ currentPassword: formValue(body, 'currentPassword'), newPassword: formValue(body, 'newPassword') }); if (!input.success) throw new AppError('invalid_password', '新密碼必須是 12–128 字元', 400); const response = await internalAuthPost(c, '/change-password', { ...input.data, revokeOtherSessions: true }); if (!response.ok) throw new AppError('password_change_failed', response.status === 429 ? '嘗試次數過多，請稍後再試' : '目前密碼錯誤', response.status === 429 ? 429 : 400); copyCookies(c, response); return c.redirect('/editor', 303); });

  app.get('/', async (c) => c.redirect(await readSession(c, auth, config) ? '/editor' : '/auth/login'));
  app.get('/onboarding', (c) => database.getBlogForUser(c.get('session').user.id) ? c.redirect('/editor') : c.html(document('匯入 HackMD', <section class="card stack"><h1>連接你的 HackMD</h1><p>輸入公開 HackMD username，我們只會匯入已發布且任何人可閱讀的文章。</p><form method="post" action="/actions/blog/connect" data-operation><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><label for="hackmdUsername">HackMD username</label><input id="hackmdUsername" name="hackmdUsername" required maxlength={100}/><button type="submit">同步並建立預覽</button></form><p id="operation-status" class="status" aria-live="polite"></p></section>, c.get('cspNonce'), c.get('session'), true)));

  function ownedBlog(c: AppContext): BlogRecord { const blog = database.getBlogForUser(c.get('session').user.id); if (!blog) throw new AppError('blog_not_found', '請先連接 HackMD', 404); return blog; }
  function redirectOrJson(c: AppContext, operationId: string) { const operationUrl = `/operations/${operationId}`; return c.req.header('accept')?.includes('application/json') ? c.json({ operationUrl, pollUrl: `/api/operations/${operationId}` }, 202) : c.redirect(operationUrl, 303); }
  async function mutationBody(c: AppContext) { assertMutationOrigin(c, config); const body = await c.req.parseBody(); assertCsrfToken(formValue(body, 'csrfToken'), c.get('session').csrfToken); return body; }
  function enqueue(c: AppContext, type: OperationType, payload: Record<string, unknown> = {}) { const blog = ownedBlog(c); try { const operation = type === 'generate_theme' ? database.createThemeOperation(blog.userId, blog.id, String(payload.prompt), { userDailyLimit: config.aiUserDailyLimit, globalDailyLimit: config.aiGlobalDailyLimit }) : database.createOperation(blog.userId, blog.id, type, payload); return redirectOrJson(c, operation.id); } catch (error) { if (error instanceof AiQuotaExceededError) throw new AppError('ai_quota_exceeded', '今天的 AI 樣式額度已用完', 429, { 'Retry-After': String(error.retryAfter) }); if (error instanceof Error && (error.message.includes('UNIQUE constraint') || error.message.includes('active operation'))) throw new AppError('operation_in_progress', '目前已有操作進行中', 409); throw error; } }

  app.post('/actions/blog/connect', async (c) => { const body = await mutationBody(c); const input = hackmdInput.safeParse({ hackmdUsername: formValue(body, 'hackmdUsername') }); if (!input.success) throw new AppError('invalid_hackmd_username', 'HackMD username 格式錯誤', 400); if (database.getBlogForUser(c.get('session').user.id)) throw new AppError('one_blog_only', '每個帳號只能建立一個 blog', 409); try { const created = database.createBlog(c.get('session').user.id, c.get('session').user.username, input.data.hackmdUsername); return redirectOrJson(c, created.operation.id); } catch (error) { if (error instanceof Error && error.message.includes('UNIQUE constraint')) throw new AppError('blog_unavailable', '無法建立 blog', 409); throw error; } });
  app.post('/actions/blog/sync', async (c) => { await mutationBody(c); return enqueue(c, 'sync'); });
  app.post('/actions/theme/generate', async (c) => { const body = await mutationBody(c); const input = themeInput.safeParse({ prompt: formValue(body, 'prompt') }); if (!input.success) throw new AppError('invalid_theme_prompt', '請用 1–1000 字描述想要的樣式', 400); return enqueue(c, 'generate_theme', input.data); });
  app.post('/actions/theme/:id/activate', async (c) => { await mutationBody(c); const blog = ownedBlog(c); const id = uuidInput.safeParse(c.req.param('id')); if (!id.success) throw new AppError('invalid_revision', '樣式版本不存在', 404); database.activateTheme(id.data, blog.id); return c.redirect('/editor', 303); });
  app.post('/actions/publish', async (c) => { await mutationBody(c); return enqueue(c, 'publish'); });

  app.get('/editor', (c) => {
    const blog = database.getBlogForUser(c.get('session').user.id); if (!blog) return c.redirect('/onboarding');
    const themes = database.listThemes(blog.id); let previewUrl: string | null = null;
    if (blog.draftArtifact) { const token = randomToken(); database.createPreviewSession(hashToken(token), blog.userId, blog.id, new Date(Date.now() + 15 * 60_000).toISOString()); previewUrl = `${config.previewOrigin}/preview-access/${encodeURIComponent(token)}`; }
    const published = database.getActiveRelease(blog.id);
    return c.html(document('編輯 Blog', <div class="editor"><section class="controls" aria-label="Blog 控制"><div><h1>{blog.title ?? blog.username}</h1><p class="muted">來源：@{blog.hackmdUsername} · {blog.state === 'syncing' ? '正在同步' : blog.state === 'failed' ? '同步失敗' : '內容已同步'}</p>{blog.lastError ? <p class="error" role="alert">{blog.lastError}</p> : null}{published ? <p><a href={siteUrl(config, blog.username)} target="_blank" rel="noreferrer">查看已發布網站</a></p> : null}</div><section class="card"><h2>同步內容</h2><form method="post" action="/actions/blog/sync" data-operation><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><button class="secondary" type="submit">重新同步 HackMD</button></form></section><section class="card"><h2>設計樣式</h2><form method="post" action="/actions/theme/generate" data-operation><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><label for="prompt">描述你想要的感覺</label><textarea id="prompt" name="prompt" maxlength={1000} required placeholder="例如：像安靜的獨立雜誌，奶油色背景、深藍連結"></textarea><button type="submit">產生新樣式</button></form></section><section class="card"><h2>歷史樣式</h2><div class="stack">{themes.map((theme) => <div class="revision"><div><strong>{theme.description}</strong><br/><small class="muted">{new Date(theme.createdAt).toLocaleString('zh-TW')}</small></div>{theme.active ? <span>使用中</span> : <form method="post" action={`/actions/theme/${theme.id}/activate`}><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><button class="secondary" type="submit">切換</button></form>}</div>)}</div></section><section class="card"><h2>發布</h2><p class="muted">發布會建立一份不再變動的網站版本。</p><form method="post" action="/actions/publish" data-operation><input type="hidden" name="csrfToken" value={c.get('session').csrfToken}/><button type="submit" disabled={!blog.draftArtifact}>發布到 {blog.username}.{config.appHostname}</button></form></section><p id="operation-status" class="status" aria-live="polite"></p></section><section aria-label="Blog 預覽">{previewUrl ? <iframe class="preview" src={previewUrl} title={`${blog.title ?? blog.username} 的即時預覽`} sandbox="allow-same-origin"></iframe> : <div class="preview card"><p>內容同步完成後，預覽會出現在這裡。</p></div>}</section></div>, c.get('cspNonce'), c.get('session'), true));
  });
  app.get('/operations/:id', (c) => { const id = uuidInput.safeParse(c.req.param('id')); const operation = id.success ? database.getOperation(id.data, c.get('session').user.id) : null; if (!operation) throw new AppError('operation_not_found', '操作不存在', 404); const labels = { sync: '同步內容', generate_theme: '設計樣式', publish: '發布網站' }; return c.html(document(labels[operation.type], <section class="card stack"><h1>{labels[operation.type]}</h1><p class="status" aria-live="polite" data-poll-url={`/api/operations/${operation.id}`}>{operation.status === 'failed' ? operation.errorMessage : operation.status === 'succeeded' ? '完成' : '處理中，請稍候…'}</p><p><a href="/editor">返回編輯器</a></p></section>, c.get('cspNonce'), c.get('session'), true)); });
  app.get('/api/session', (c) => c.json({ user: c.get('session').user, csrfToken: c.get('session').csrfToken }));
  app.get('/api/operations/:id', (c) => { const id = uuidInput.safeParse(c.req.param('id')); const operation = id.success ? database.getOperation(id.data, c.get('session').user.id) : null; if (!operation) throw new AppError('operation_not_found', '操作不存在', 404); return c.json({ status: operation.status, message: operation.status === 'failed' ? operation.errorMessage : operation.status === 'succeeded' ? (typeof operation.result?.message === 'string' ? operation.result.message : '完成') : '處理中，請稍候…' }); });

  app.get('/preview-access/:token', (c) => { const preview = database.getPreviewSession(hashToken(c.req.param('token'))); if (!preview) throw new AppError('preview_access_denied', 'Preview access expired or invalid', 403); setCookie(c, 'vibelog_preview', c.req.param('token'), { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', maxAge: 900 }); return c.redirect('/'); });
  return { app, auth, database, config };
}
