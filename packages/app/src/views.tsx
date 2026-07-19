import type { AppSession } from './auth.js';
import type { BlogRecord, OperationRecord, PublishedReleaseRecord, ThemeRevisionRecord } from './database.js';
import { operationMessage, OPERATION_LABELS } from './operation-status.js';

const styles = `
:root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #202124; background: #f6f5f2; line-height: 1.5; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #075985; }
button, input, textarea { font: inherit; }
button { cursor: pointer; min-height: 3rem; }
.shell { max-width: 90rem; margin: auto; padding: 1rem; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: .5rem 1rem; }
.topbar nav { display: flex; align-items: center; gap: .75rem; }
.button, button { border: 1px solid #202124; border-radius: .45rem; background: #202124; color: #fff; padding: .65rem 1rem; text-decoration: none; }
.secondary { background: transparent; color: #202124; }
.stack { display: grid; gap: 1rem; }
.card { background: #fff; border: 1px solid #d8d5cd; border-radius: .75rem; padding: 1rem; }
.editor { display: grid; grid-template-columns: minmax(18rem, 25rem) minmax(0, 1fr); gap: 1rem; align-items: start; }
.controls { display: grid; gap: 1rem; }
.preview { min-height: 75vh; width: 100%; border: 1px solid #b8b4aa; border-radius: .75rem; background: #fff; }
.muted { color: #62605b; }
.error { color: #a12622; }
.status { border-left: 4px solid #075985; padding: .5rem .75rem; }
.status:empty { display: none; }
.status.error { border-left-color: #a12622; }
.pill { display: inline-flex; align-items: center; border: 1px solid #8a877f; border-radius: 999px; padding: .2rem .65rem; font-size: .875rem; font-weight: 600; }
.pill.pending { border-color: #9a6700; background: #fff8c5; }
.pill.live { border-color: #1a7f37; background: #dafbe1; }
.markers { display: flex; flex-wrap: wrap; gap: .35rem; }
.marker { border: 1px solid #b8b4aa; border-radius: 999px; padding: .1rem .45rem; font-size: .75rem; }
.revision { display: flex; justify-content: space-between; gap: .75rem; align-items: center; }
.revision > div:first-child { min-width: 0; }
form { display: grid; gap: .65rem; }
input, textarea { width: 100%; min-height: 3rem; padding: .65rem; border: 1px solid #76736c; border-radius: .4rem; font-size: 1rem; }
textarea { min-height: 7rem; resize: vertical; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, output:focus-visible { outline: 3px solid #f59e0b; outline-offset: 3px; }
button:disabled { cursor: not-allowed; opacity: .55; }
@media (max-width: 52rem) {
  .editor { grid-template-columns: 1fr; }
  .preview { min-height: 65vh; }
  .topbar { align-items: flex-start; }
  .topbar nav { flex-wrap: wrap; justify-content: flex-end; }
}
`;

export function document(title: string, content: unknown, nonce: string, session?: AppSession, editor = false) {
  return <html lang="zh-Hant">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>{title} · VibeLog</title>
      <style nonce={nonce}>{styles}</style>
    </head>
    <body>
      <div class="shell">
        <header class="topbar">
          <a href="/editor"><strong>VibeLog</strong></a>
          {session ? <nav aria-label="帳號">
            <a href="/auth/change-password">修改密碼</a>
            <form method="post" action="/auth/logout">
              <input type="hidden" name="csrfToken" value={session.csrfToken}/>
              <button class="secondary" type="submit">登出</button>
            </form>
          </nav> : null}
        </header>
        <main>{content}</main>
      </div>
      {editor ? <script type="module" src="/assets/client.js"></script> : null}
    </body>
  </html>;
}

export function loginPage(nonce: string, message?: string) {
  return document('登入', <section class="card stack">
    <h1>登入</h1>
    {message ? <p class="error" role="alert">{message}</p> : null}
    <form method="post" action="/auth/login">
      <label for="username">Username</label>
      <input id="username" name="username" required minlength={3} maxlength={32} autocomplete="username" autofocus/>
      <label for="password">密碼</label>
      <input id="password" name="password" type="password" required maxlength={128} autocomplete="current-password"/>
      <button type="submit">登入</button>
    </form>
    <p><a href="/auth/register">使用邀請碼建立帳號</a></p>
  </section>, nonce);
}

export function registerPage(nonce: string, message?: string) {
  return document('建立帳號', <section class="card stack">
    <h1>建立 VibeLog</h1>
    <p class="muted">Beta 期間需要邀請碼。Username 也會成為你的網址，建立後無法修改。</p>
    {message ? <p class="error" role="alert">{message}</p> : null}
    <form method="post" action="/auth/register">
      <label for="inviteCode">Beta 邀請碼</label>
      <input id="inviteCode" name="inviteCode" type="password" required autocomplete="off"/>
      <label for="username">Username</label>
      <input id="username" name="username" required minlength={3} maxlength={32} pattern="[A-Za-z0-9_-]+" autocomplete="username"/>
      <label for="password">密碼</label>
      <input id="password" name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/>
      <button type="submit">建立帳號</button>
    </form>
    <p><a href="/auth/login">返回登入</a></p>
  </section>, nonce);
}

export function changePasswordPage(nonce: string, session: AppSession) {
  return document('修改密碼', <section class="card stack">
    <h1>修改密碼</h1>
    <form method="post" action="/auth/change-password">
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <label for="currentPassword">目前密碼</label>
      <input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password"/>
      <label for="newPassword">新密碼</label>
      <input id="newPassword" name="newPassword" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/>
      <button type="submit">更新密碼</button>
    </form>
  </section>, nonce, session);
}

function OperationOutput({ operation }: { operation?: OperationRecord }) {
  const pending = operation && (operation.status === 'queued' || operation.status === 'running');
  return <output
    class={`status${operation?.status === 'failed' ? ' error' : ''}`}
    aria-live="polite"
    tabindex={-1}
    data-operation-status
    data-poll-url={pending ? `/api/operations/${operation.id}` : undefined}
  >{operation ? operationMessage(operation) : ''}</output>;
}

export function onboardingPage(nonce: string, session: AppSession, blog: BlogRecord | null, operation: OperationRecord | null) {
  const failed = blog?.state === 'failed' ? blog.lastError : null;
  const busy = operation?.status === 'queued' || operation?.status === 'running';
  return document('匯入 HackMD', <section class="card stack">
    <h1>連接你的 HackMD</h1>
    <p id="hackmd-help">輸入公開 HackMD username，我們只會匯入已發布且任何人可閱讀的文章。第一次同步成功前都可以修正 username。</p>
    {failed ? <p id="hackmd-error" class="error" role="alert">{failed}</p> : null}
    <form method="post" action="/actions/blog/connect" data-operation data-success-url="/editor" aria-busy={busy ? 'true' : undefined}>
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <label for="hackmdUsername">HackMD username</label>
      <input
        id="hackmdUsername"
        name="hackmdUsername"
        required
        maxlength={100}
        value={blog?.hackmdUsername ?? ''}
        aria-describedby={`hackmd-help${failed ? ' hackmd-error' : ''}`}
      />
      <button type="submit" disabled={busy}>{blog ? '修正並重新同步' : '同步並建立預覽'}</button>
      <OperationOutput operation={operation ?? undefined}/>
    </form>
  </section>, nonce, session, true);
}

interface EditorPageInput {
  nonce: string;
  session: AppSession;
  blog: BlogRecord;
  themes: ThemeRevisionRecord[];
  activeTheme: ThemeRevisionRecord;
  published: PublishedReleaseRecord | null;
  previewUrl: string | null;
  publicUrl: string;
  appHostname: string;
}

export function editorPage(input: EditorPageInput) {
  const { blog, themes, activeTheme, published } = input;
  const hasChanges = !published || published.contentVersion !== blog.contentVersion || published.themeRevisionId !== activeTheme.id;
  const publication = !published
    ? { label: '尚未發布', className: 'pill pending' }
    : hasChanges ? { label: '有未發布變更', className: 'pill pending' } : { label: '已與線上版本同步', className: 'pill live' };
  const publishLabel = !published ? '發布第一版' : hasChanges ? '發布變更' : '已是最新版本';

  return document('編輯 Blog', <div class="editor">
    <section class="controls" aria-label="Blog 控制">
      <div class="stack">
        <div>
          <h1>{blog.title ?? blog.username}</h1>
          <span class={publication.className}>{publication.label}</span>
        </div>
        <p class="muted">來源：@{blog.hackmdUsername} · {blog.state === 'syncing' ? '正在同步' : blog.lastError ? '上次同步失敗，仍保留現有內容' : '內容已同步'}</p>
        {blog.lastError ? <p class="error" role="alert">{blog.lastError}</p> : null}
        {published ? <p>
          <a href={input.publicUrl} target="_blank" rel="noreferrer">查看已發布網站</a><br/>
          <small class="muted">上次發布：{new Date(published.createdAt).toLocaleString('zh-TW')}</small>
        </p> : null}
      </div>

      <section class="card">
        <h2>同步內容</h2>
        <form method="post" action="/actions/blog/sync" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <button class="secondary" type="submit">重新同步 HackMD</button>
          <OperationOutput/>
        </form>
      </section>

      <section class="card">
        <h2>設計樣式</h2>
        <form method="post" action="/actions/theme/generate" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <label for="prompt">描述你想要的感覺</label>
          <textarea id="prompt" name="prompt" maxlength={1000} required placeholder="例如：像安靜的獨立雜誌，奶油色背景、深藍連結"></textarea>
          <button type="submit">產生新樣式</button>
          <OperationOutput/>
        </form>
      </section>

      <section class="card">
        <h2>歷史樣式</h2>
        <div class="stack">{themes.map((theme) => <div class="revision">
          <div>
            <strong>{theme.description}</strong>
            <div class="markers">
              {theme.active ? <span class="marker">預覽中</span> : null}
              {published?.themeRevisionId === theme.id ? <span class="marker">線上版本</span> : null}
            </div>
            <small class="muted">{new Date(theme.createdAt).toLocaleString('zh-TW')}</small>
          </div>
          {theme.active ? null : <form method="post" action={`/actions/theme/${theme.id}/activate`}>
            <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
            <button class="secondary" type="submit">切換預覽</button>
          </form>}
        </div>)}</div>
      </section>

      <section class="card">
        <h2>發布</h2>
        <p class="muted">發布會固定目前的內容與樣式，線上版本在下一次發布前不會改變。</p>
        <form method="post" action="/actions/publish" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <button type="submit" disabled={!blog.draftArtifact || !hasChanges}>{publishLabel}到 {blog.username}.{input.appHostname}</button>
          <OperationOutput/>
        </form>
      </section>
    </section>

    <section aria-label="Blog 預覽">{input.previewUrl
      ? <iframe class="preview" src={input.previewUrl} title={`${blog.title ?? blog.username} 的即時預覽`} sandbox="allow-same-origin"></iframe>
      : <div class="preview card"><p>內容同步完成後，預覽會出現在這裡。</p></div>}
    </section>
  </div>, input.nonce, input.session, true);
}

export function operationPage(nonce: string, session: AppSession, operation: OperationRecord, backUrl: string) {
  const pending = operation.status === 'queued' || operation.status === 'running';
  return document(OPERATION_LABELS[operation.type], <section class="card stack">
    <h1>{OPERATION_LABELS[operation.type]}</h1>
    <output
      class={`status${operation.status === 'failed' ? ' error' : ''}`}
      aria-live="polite"
      tabindex={-1}
      data-operation-status
      data-poll-url={pending ? `/api/operations/${operation.id}` : undefined}
      data-success-url="/editor"
    >{operationMessage(operation)}</output>
    {pending ? <p><a href={`/operations/${operation.id}`}>重新整理狀態</a></p> : null}
    <p><a href={backUrl}>{operation.status === 'failed' ? '返回並重試' : '返回編輯器'}</a></p>
  </section>, nonce, session, true);
}
