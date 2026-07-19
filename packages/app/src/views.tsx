import type { AppSession } from './auth.js';
import type { BlogRecord, OperationRecord, PublishedReleaseRecord, ThemeRevisionRecord } from './database.js';
import { syncOperationIntent } from './blog-sync.js';
import { operationLabel, operationMessage } from './operation-status.js';
import { THEME_PALETTES, themeControlValues } from './theme-studio.js';

const styles = `
:root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #182027; background: #f2f5f6; line-height: 1.5; accent-color: #3157c8; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #2448b8; }
button, input, textarea { font: inherit; }
button { cursor: pointer; min-height: 3rem; }
.shell { max-width: 90rem; margin: auto; padding: 1rem; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: .5rem 1rem; }
.topbar nav { display: flex; align-items: center; gap: .75rem; }
.button, button { border: 1px solid #182027; border-radius: .45rem; background: #182027; color: #fff; padding: .65rem 1rem; text-decoration: none; }
.secondary { background: transparent; color: #182027; }
.stack { display: grid; gap: 1rem; }
.card { background: #fff; border: 1px solid #ced6da; border-radius: .75rem; padding: 1rem; }
.editor { display: grid; grid-template-columns: minmax(21rem, 29rem) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.controls { display: grid; gap: 1rem; }
.preview-panel { position: sticky; top: 1rem; }
.preview-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-block-end: .6rem; }
.preview-heading h2 { margin: 0; font: 600 .875rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
.preview { min-height: 78vh; width: 100%; border: 1px solid #9ba8ae; border-radius: .35rem; background: #fff; box-shadow: 0 .75rem 2rem rgb(30 44 52 / .1); }
.muted { color: #58666d; }
.error { color: #a12622; }
.status { border-left: 4px solid #3157c8; padding: .5rem .75rem; }
.status:empty { display: none; }
.status.error { border-left-color: #a12622; }
.pill { display: inline-flex; align-items: center; border: 1px solid #8a877f; border-radius: 999px; padding: .2rem .65rem; font-size: .875rem; font-weight: 600; }
.pill.pending { border-color: #9a6700; background: #fff8c5; }
.pill.live { border-color: #1a7f37; background: #dafbe1; }
.markers { display: flex; flex-wrap: wrap; gap: .35rem; }
.marker { border: 1px solid #aeb9be; border-radius: 999px; padding: .1rem .45rem; font-size: .75rem; }
.revision { display: flex; justify-content: space-between; gap: .75rem; align-items: center; }
.revision > div:first-child { min-width: 0; }
form { display: grid; gap: .65rem; }
input, textarea { width: 100%; min-height: 3rem; padding: .65rem; border: 1px solid #76736c; border-radius: .4rem; font-size: 1rem; }
textarea { min-height: 7rem; resize: vertical; }
input:user-invalid, textarea:user-invalid { border-color: #a12622; background: #fff5f5; box-shadow: 0 0 0 1px #a12622; }
.validation-error { display: none; color: #a12622; font-size: .875rem; }
input:user-invalid + .validation-error, textarea:user-invalid + .validation-error { display: block; }
.field-hint { margin: -.35rem 0 0; color: #58666d; font-size: .875rem; }
.content-summary { display: grid; gap: .65rem; }
.content-summary p { margin: 0; }
.content-list { display: grid; gap: .55rem; margin-block-end: 0; padding-inline-start: 1.25rem; }
.content-list li { padding-inline-start: .2rem; }
.content-list time { display: block; color: #58666d; font-size: .875rem; }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible, output:focus-visible { outline: 3px solid #e59b19; outline-offset: 3px; }
button:disabled { cursor: not-allowed; opacity: .55; }
.studio-card { border-top: .35rem solid #3157c8; padding: 1.1rem; }
.studio-card h2 { margin-block: 0; font-family: ui-serif, Georgia, serif; font-size: 1.6rem; }
.studio-lede { margin-block-start: .25rem; }
.prompt-starters { display: flex; flex-wrap: wrap; gap: .45rem; }
.prompt-chip { min-height: 2.5rem; border-color: #a8b4ba; border-radius: 999px; background: #f4f7ff; color: #243763; padding: .45rem .75rem; text-align: left; }
.studio-actions { display: grid; }
.theme-controls { border-top: 1px solid #d8dfe2; padding-block-start: .8rem; }
.theme-controls summary, .history summary { cursor: pointer; font-weight: 700; padding-block: .35rem; }
.theme-control-stack { display: grid; gap: 1rem; padding-block-start: .85rem; }
fieldset { min-width: 0; margin: 0; border: 0; padding: 0; }
legend { margin-block-end: .45rem; font-weight: 650; }
.choice-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .45rem; }
.choice { display: flex; align-items: center; gap: .45rem; min-height: 2.75rem; border: 1px solid #c4cdd1; border-radius: .45rem; padding: .45rem .55rem; cursor: pointer; }
.choice:has(input:checked) { border-color: #3157c8; background: #eef2ff; box-shadow: inset 0 0 0 1px #3157c8; }
.choice input { width: 1rem; min-height: 1rem; margin: 0; }
.palette-choice { align-items: flex-start; flex-direction: column; gap: .35rem; }
.palette-label { display: flex; align-items: center; gap: .45rem; }
.swatches { display: grid; grid-template-columns: repeat(3, 1rem); gap: .15rem; }
.swatch { width: 1rem; height: 1rem; border: 1px solid rgb(0 0 0 / .18); border-radius: 50%; }
.palette-paper .swatch:nth-child(1) { background: #fcfbf7; } .palette-paper .swatch:nth-child(2) { background: #24211c; } .palette-paper .swatch:nth-child(3) { background: #1f5d8f; }
.palette-newsprint .swatch:nth-child(1) { background: #f5f0e6; } .palette-newsprint .swatch:nth-child(2) { background: #1f1b16; } .palette-newsprint .swatch:nth-child(3) { background: #8b2f2f; }
.palette-mist .swatch:nth-child(1) { background: #f4f7f8; } .palette-mist .swatch:nth-child(2) { background: #17252d; } .palette-mist .swatch:nth-child(3) { background: #075985; }
.palette-pine .swatch:nth-child(1) { background: #f4f7f2; } .palette-pine .swatch:nth-child(2) { background: #1d291c; } .palette-pine .swatch:nth-child(3) { background: #2f6b3c; }
.palette-midnight .swatch:nth-child(1) { background: #111827; } .palette-midnight .swatch:nth-child(2) { background: #f3f4f6; } .palette-midnight .swatch:nth-child(3) { background: #7dd3fc; }
.palette-charcoal .swatch:nth-child(1) { background: #181817; } .palette-charcoal .swatch:nth-child(2) { background: #f5f5f0; } .palette-charcoal .swatch:nth-child(3) { background: #f0b35b; }
.unsaved-note { margin: 0; color: #785300; font-weight: 650; }
.history[open] summary { margin-block-end: .8rem; }
@media (max-width: 52rem) {
  .editor { grid-template-columns: 1fr; }
  .preview-panel { position: static; }
  .preview { min-height: 65vh; }
  .topbar { align-items: flex-start; }
  .topbar nav { flex-wrap: wrap; justify-content: flex-end; }
}
@media (max-width: 30rem) {
  .choice-grid { grid-template-columns: 1fr; }
  .topbar { display: grid; grid-template-columns: 1fr; }
  .topbar nav { justify-content: flex-start; }
}
@media (pointer: coarse) { .choice, .prompt-chip { min-height: 3rem; } }
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
      {editor ? <script type="module" src={`/assets/client.js?v=${nonce}`}></script> : null}
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
  releases: PublishedReleaseRecord[];
  previewUrl: string | null;
  previewToken: string;
  publicUrl: string;
  appHostname: string;
  operation?: OperationRecord | null;
}

const CONTROL_OPTIONS = {
  preset: [['minimal', 'Minimal'], ['editorial', 'Editorial'], ['notebook', 'Notebook']],
  bodyFont: [['system-sans', 'Sans'], ['system-serif', 'Serif']],
  headingFont: [['system-sans', 'Sans'], ['system-serif', 'Serif'], ['system-mono', 'Mono']],
  scale: [['compact', 'Compact'], ['comfortable', 'Medium'], ['large', 'Large']],
  contentWidth: [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']],
  density: [['compact', 'Compact'], ['comfortable', 'Comfortable']],
  radius: [['none', 'Square'], ['soft', 'Soft'], ['round', 'Round']],
} as const;

function ChoiceGroup({ legend, name, options, value }: { legend: string; name: string; options: readonly (readonly [string, string])[]; value: string }) {
  return <fieldset>
    <legend>{legend}</legend>
    <div class="choice-grid">{options.map(([option, label]) => <label class="choice">
      <input type="radio" name={name} value={option} checked={value === option} data-theme-control/>
      <span>{label}</span>
    </label>)}</div>
  </fieldset>;
}

const SOURCE_LABEL = { system: '初始', ai: 'AI', manual: '手動' } as const;

export function editorPage(input: EditorPageInput) {
  const { blog, themes, activeTheme, published, releases } = input;
  const controls = themeControlValues(activeTheme.config);
  const themesById = new Map(themes.map((theme) => [theme.id, theme]));
  const busy = Boolean(input.operation && (input.operation.status === 'queued' || input.operation.status === 'running'));
  const hasChanges = !published || published.contentVersion !== blog.contentVersion || published.themeRevisionId !== activeTheme.id;
  const publication = !published
    ? { label: '尚未發布', className: 'pill pending' }
    : hasChanges ? { label: '有未發布變更', className: 'pill pending' } : { label: '已與線上版本同步', className: 'pill live' };
  const publishLabel = !published ? '發布第一版' : hasChanges ? '發布變更' : '已是最新版本';
  const identityOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'identity' ? input.operation : undefined;
  const contentOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'content' ? input.operation : undefined;

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
        <h2>Blog 資訊</h2>
        <p class="muted">會顯示在網站標題、搜尋摘要、Open Graph 與 RSS。儲存時也會取得最新 HackMD 內容。</p>
        <form method="post" action="/actions/blog/identity" data-operation aria-busy={identityOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <label for="blogTitle">Blog 標題</label>
          <input
            id="blogTitle"
            name="title"
            required
            minlength={1}
            maxlength={80}
            value={blog.title ?? ''}
            aria-describedby="blog-title-help"
            aria-errormessage="blog-title-error"
          />
          <span id="blog-title-error" class="validation-error"><span aria-hidden="true">!</span> 請輸入 1–80 字元的標題。</span>
          <p id="blog-title-help" class="field-hint">最多 80 字元。</p>
          <label for="blogDescription">Blog 描述</label>
          <textarea id="blogDescription" name="description" maxlength={240} aria-describedby="blog-description-help">{blog.description ?? ''}</textarea>
          <p id="blog-description-help" class="field-hint">最多 240 字元，可以留空。</p>
          <button type="submit" disabled={busy}>儲存並重建草稿</button>
          <OperationOutput operation={identityOperation}/>
        </form>
      </section>

      <section class="card">
        <h2>同步內容</h2>
        <div class="content-summary">
          {blog.lastSyncedAt
            ? <p class="muted">上次成功同步：<time datetime={blog.lastSyncedAt}>{new Date(blog.lastSyncedAt).toLocaleString('zh-TW')}</time></p>
            : <p class="muted">尚無同步摘要；重新同步後會顯示文章清單。</p>}
          {blog.contentManifest
            ? <details>
              <summary>已匯入文章（{blog.contentManifest.length}）</summary>
              {blog.contentManifest.length > 0
                ? <ol class="content-list">{blog.contentManifest.map((post) => <li>
                  <span>{post.title}</span>
                  <time datetime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('zh-TW')}</time>
                </li>)}</ol>
                : <p class="muted">這份摘要沒有文章。</p>}
            </details>
            : null}
        </div>
        <form method="post" action="/actions/blog/sync" data-operation aria-busy={contentOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <button class="secondary" type="submit" disabled={busy}>重新同步 HackMD</button>
          <OperationOutput operation={contentOperation}/>
        </form>
      </section>

      <section class="card studio-card">
        <form method="post" action="/actions/theme/apply" data-operation data-mixed-actions data-theme-studio>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <h2>Theme Studio</h2>
          <p class="muted studio-lede">先說你想要的閱讀感受，再用安全選項微調。AI 不會改文章或寫入任意 CSS。</p>
          <label for="prompt">描述你想要的感覺</label>
          <textarea id="prompt" name="prompt" maxlength={1000} placeholder="例如：讓長文章讀起來像一本克制的獨立雜誌"></textarea>
          <div class="prompt-starters" aria-label="描述建議">
            {['更像一本克制的獨立雜誌', '提高長文閱讀舒適度', '保留極簡，但增加一點個性', '改成適合夜間閱讀的深色設計'].map((prompt) => <button class="prompt-chip" type="button" data-prompt-starter={prompt} aria-controls="prompt">{prompt}</button>)}
          </div>
          <button type="submit" formaction="/actions/theme/generate" data-operation-submit disabled={busy}>交給 AI 設計</button>

          <details class="theme-controls">
            <summary>手動微調安全樣式</summary>
            <div class="theme-control-stack">
              <ChoiceGroup legend="版面" name="preset" options={CONTROL_OPTIONS.preset} value={controls.preset}/>
              <fieldset>
                <legend>配色</legend>
                {!controls.palette ? <p class="muted">目前使用 AI 配色；選擇以下配色才會覆蓋。</p> : null}
                <div class="choice-grid">{Object.entries(THEME_PALETTES).map(([name, palette]) => <label class={`choice palette-choice palette-${name}`}>
                  <span class="palette-label"><input type="radio" name="palette" value={name} checked={controls.palette === name} data-theme-control/> {palette.label}</span>
                  <span class="swatches" aria-hidden="true"><span class="swatch"></span><span class="swatch"></span><span class="swatch"></span></span>
                </label>)}</div>
              </fieldset>
              <ChoiceGroup legend="內文字體" name="bodyFont" options={CONTROL_OPTIONS.bodyFont} value={controls.bodyFont}/>
              <ChoiceGroup legend="標題字體" name="headingFont" options={CONTROL_OPTIONS.headingFont} value={controls.headingFont}/>
              <ChoiceGroup legend="字級" name="scale" options={CONTROL_OPTIONS.scale} value={controls.scale}/>
              <ChoiceGroup legend="內容寬度" name="contentWidth" options={CONTROL_OPTIONS.contentWidth} value={controls.contentWidth}/>
              <ChoiceGroup legend="留白" name="density" options={CONTROL_OPTIONS.density} value={controls.density}/>
              <ChoiceGroup legend="圓角" name="radius" options={CONTROL_OPTIONS.radius} value={controls.radius}/>
            </div>
          </details>
          <div class="studio-actions"><button class="secondary" type="submit" disabled={busy}>儲存成新版本</button></div>
          <p class="unsaved-note" data-unsaved-note hidden>這些樣式尚未儲存；儲存後才能發布。</p>
          <OperationOutput operation={input.operation?.type === 'generate_theme' ? input.operation : undefined}/>
        </form>
      </section>

      <section class="card">
        <details class="history">
        <summary>歷史樣式（{themes.length}）</summary>
        <div class="stack">{themes.map((theme) => <div class="revision">
          <div>
            <strong>{theme.description}</strong>
            <div class="markers">
              <span class="marker">{SOURCE_LABEL[theme.source]}</span>
              {theme.active ? <span class="marker">預覽中</span> : null}
              {published?.themeRevisionId === theme.id ? <span class="marker">線上版本</span> : null}
            </div>
            <small class="muted">{new Date(theme.createdAt).toLocaleString('zh-TW')}</small>
          </div>
          {theme.active ? null : <form method="post" action={`/actions/theme/${theme.id}/activate`}>
            <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
            <button class="secondary" type="submit" disabled={busy}>切換預覽</button>
          </form>}
        </div>)}</div></details>
      </section>

      <section class="card">
        <h2>發布</h2>
        <p class="muted">發布會固定目前的內容與樣式，線上版本在下一次發布前不會改變。</p>
        <form method="post" action="/actions/publish" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <button type="submit" data-publish-button disabled={!blog.draftArtifact || !hasChanges || busy}>{publishLabel}到 {blog.username}.{input.appHostname}</button>
          <OperationOutput operation={input.operation?.type === 'publish' ? input.operation : undefined}/>
        </form>
        {releases.length > 0 ? <details class="history">
          <summary>發布紀錄（{releases.length}）</summary>
          <div class="stack">{releases.map((release) => {
            const theme = themesById.get(release.themeRevisionId);
            return <div class="revision">
              <div>
                <strong>{theme?.description ?? '已發布樣式'}</strong>
                <div class="markers">
                  {theme ? <span class="marker">{SOURCE_LABEL[theme.source]}</span> : null}
                  {release.active ? <span class="marker">目前線上</span> : null}
                </div>
                <small class="muted">{new Date(release.createdAt).toLocaleString('zh-TW')}</small>
              </div>
              {release.active ? null : <form method="post" action={`/actions/releases/${release.id}/activate`}>
                <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
                <button class="secondary" type="submit" disabled={busy}>還原為線上版本</button>
              </form>}
            </div>;
          })}</div>
        </details> : null}
      </section>
    </section>

    <section class="preview-panel" aria-label="Blog 預覽">
      <div class="preview-heading"><h2>Draft preview</h2><small class="muted">只更新樣式，不重建內容</small></div>
      {input.previewUrl
      ? <iframe class="preview" src={input.previewUrl} data-preview-url={input.previewUrl} title={`${blog.title ?? blog.username} 的即時預覽`} sandbox="allow-same-origin"></iframe>
      : <div class="preview card"><p>內容同步完成後，預覽會出現在這裡。</p></div>}
    </section>
  </div>, input.nonce, input.session, true);
}

export function operationPage(nonce: string, session: AppSession, operation: OperationRecord, backUrl: string) {
  const pending = operation.status === 'queued' || operation.status === 'running';
  const label = operationLabel(operation);
  return document(label, <section class="card stack">
    <h1>{label}</h1>
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
