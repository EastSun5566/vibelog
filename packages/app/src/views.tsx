import type { AppSession } from './auth.js';
import type { BlogRecord, OperationRecord, PublishedReleaseRecord, SyncedPostSummary, ThemeRevisionRecord } from './database.js';
import { syncOperationIntent } from './blog-sync.js';
import { operationLabel, operationMessage } from './operation-status.js';
import { calculatePublicationDiff } from './publication-diff.js';
import { THEME_PALETTES, themeControlValues } from './theme-studio.js';

export function document(title: string, content: unknown, session?: AppSession, editor = false) {
  return <html lang="zh-Hant">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>{title} · VibeLog</title>
      <link rel="stylesheet" href="/assets/app.css"/>
    </head>
    <body>
      <div class="app-shell">
        <header class="app-header">
          <a class="app-brand" href="/editor">VibeLog</a>
          {session ? <nav class="account-nav" aria-label="帳號">
            <a class="btn" data-variant="ghost" data-size="compact" href="/auth/change-password">修改密碼</a>
            <form method="post" action="/auth/logout">
              <input type="hidden" name="csrfToken" value={session.csrfToken}/>
              <button class="btn" data-variant="outline" data-size="compact" type="submit">登出</button>
            </form>
          </nav> : null}
        </header>
        <main class="app-main">{content}</main>
      </div>
      {editor ? <script type="module" src="/assets/client.js"></script> : null}
    </body>
  </html>;
}

export function loginPage(message?: string) {
  return document('登入', <section class="auth-shell card">
    <header><p class="auth-kicker">Publishing desk</p><h1>回到你的 Blog</h1><p>登入後繼續同步內容、調整主題並發布。</p></header>
    <section class="stack">
      {message ? <div class="alert" data-variant="destructive" role="alert"><section>{message}</section></div> : null}
      <form class="stack" method="post" action="/auth/login">
        <div class="field"><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} autocomplete="username" autofocus/></div>
        <div class="field"><label for="password">密碼</label><input id="password" name="password" type="password" required maxlength={128} autocomplete="current-password"/></div>
        <button class="btn" type="submit">登入</button>
      </form>
    </section>
    <footer><a href="/auth/register">使用邀請碼建立帳號</a></footer>
  </section>);
}

export function registerPage(message?: string) {
  return document('建立帳號', <section class="auth-shell card">
    <header><p class="auth-kicker">Invite-only beta</p><h1>建立 VibeLog</h1><p>Username 也會成為你的網址，建立後無法修改。</p></header>
    <section class="stack">
      {message ? <div class="alert" data-variant="destructive" role="alert"><section>{message}</section></div> : null}
      <form class="stack" method="post" action="/auth/register">
        <div class="field"><label for="inviteCode">Beta 邀請碼</label><input id="inviteCode" name="inviteCode" type="password" required autocomplete="off"/></div>
        <div class="field"><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} pattern="[A-Za-z0-9_-]+" autocomplete="username"/><p>3–32 字元，可使用英文、數字、底線與連字號。</p></div>
        <div class="field"><label for="password">密碼</label><input id="password" name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/><p>至少 12 個字元；此 demo 不提供密碼復原。</p></div>
        <button class="btn" type="submit">建立帳號</button>
      </form>
    </section>
    <footer><a href="/auth/login">返回登入</a></footer>
  </section>);
}

export function changePasswordPage(session: AppSession) {
  return document('修改密碼', <section class="auth-shell card">
    <header><p class="auth-kicker">Account security</p><h1>修改密碼</h1><p>更新後會撤銷其他裝置上的登入狀態。</p></header>
    <section><form class="stack" method="post" action="/auth/change-password">
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <div class="field"><label for="currentPassword">目前密碼</label><input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password"/></div>
      <div class="field"><label for="newPassword">新密碼</label><input id="newPassword" name="newPassword" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/></div>
      <button class="btn" type="submit">更新密碼</button>
    </form></section>
  </section>, session);
}

function OperationOutput({ operation }: { operation?: OperationRecord }) {
  const pending = operation && (operation.status === 'queued' || operation.status === 'running');
  return <output
    class="alert operation-status"
    data-variant={operation?.status === 'failed' ? 'destructive' : undefined}
    aria-live="polite"
    tabindex={-1}
    data-operation-status
    data-poll-url={pending ? `/api/operations/${operation.id}` : undefined}
  >{operation ? operationMessage(operation) : ''}</output>;
}

export function onboardingPage(session: AppSession, blog: BlogRecord | null, operation: OperationRecord | null) {
  const failed = blog?.state === 'failed' ? blog.lastError : null;
  const busy = operation?.status === 'queued' || operation?.status === 'running';
  return document('匯入 HackMD', <section class="auth-shell card">
    <header><p class="auth-kicker">Step 1 of 1</p><h1>連接你的 HackMD</h1><p id="hackmd-help">輸入公開 HackMD username。我們只匯入已發布且任何人可閱讀的文章；第一次同步成功前都可以修正。</p></header>
    <section class="stack">
    {failed ? <div id="hackmd-error" class="alert" data-variant="destructive" role="alert"><section>{failed}</section></div> : null}
    <form class="stack" method="post" action="/actions/blog/connect" data-operation data-success-url="/editor" aria-busy={busy ? 'true' : undefined}>
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <div class="field"><label for="hackmdUsername">HackMD username</label><input
        id="hackmdUsername"
        name="hackmdUsername"
        required
        maxlength={100}
        value={blog?.hackmdUsername ?? ''}
        aria-describedby={`hackmd-help${failed ? ' hackmd-error' : ''}`}
      /></div>
      <button class="btn" type="submit" disabled={busy}>{blog ? '修正並重新同步' : '同步並建立預覽'}</button>
      <OperationOutput operation={operation ?? undefined}/>
    </form>
    </section>
  </section>, session, true);
}

interface EditorPageInput {
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
  headerStyle: [['compact', 'Compact'], ['centered', 'Centered']],
  postListStyle: [['divided', 'Divided'], ['cards', 'Cards'], ['numbered', 'Numbered']],
  codeBlockStyle: [['plain', 'Plain'], ['panel', 'Panel']],
} as const;

function ChoiceGroup({ legend, name, options, value }: { legend: string; name: string; options: readonly (readonly [string, string])[]; value: string }) {
  return <fieldset class="fieldset">
    <legend>{legend}</legend>
    <div class="choice-grid">{options.map(([option, label]) => <label class="choice">
      <input type="radio" name={name} value={option} checked={value === option} data-theme-control/>
      <span>{label}</span>
    </label>)}</div>
  </fieldset>;
}

const SOURCE_LABEL = { system: '初始', ai: 'AI', manual: '手動' } as const;

function isUpdatedOnAnotherUtcDate(publishedAt: string, updatedAt?: string): updatedAt is string {
  return Boolean(updatedAt
    && Date.parse(updatedAt) > Date.parse(publishedAt)
    && updatedAt.slice(0, 10) !== publishedAt.slice(0, 10));
}

function PublicationArticles({ label, posts, variant }: { label: string; posts: SyncedPostSummary[]; variant: 'added' | 'updated' | 'removed' }) {
  if (posts.length === 0) return null;
  return <section class="publication-change-group">
    <h4><span class="badge" data-variant={variant}>{label} {posts.length}</span></h4>
    <ul>{posts.map((post) => <li>{post.title}</li>)}</ul>
  </section>;
}

function PublicationSummary({ blog, activeTheme, published, liveTheme, hasChanges }: {
  blog: BlogRecord;
  activeTheme: ThemeRevisionRecord;
  published: PublishedReleaseRecord | null;
  liveTheme?: ThemeRevisionRecord;
  hasChanges: boolean;
}) {
  const diff = calculatePublicationDiff(blog, activeTheme, published);
  const articleChangeCount = diff.added.length + diff.updated.length + diff.removed.length;
  const identityLabels = { title: '標題', description: '描述', author: '作者' } as const;

  return <section class="publication-summary" aria-labelledby="publication-summary-title">
    <h3 id="publication-summary-title">這次會發布</h3>
    {diff.mode === 'first' ? <div class="publication-copy">
      <p><strong>第一版</strong>會包含 {diff.includedCount} 篇文章。</p>
      <p>樣式：{activeTheme.description}</p>
    </div> : null}
    {diff.mode === 'legacy' ? <div class="alert"><section>
      <p>此線上版本建立於差異追蹤前；再次發布後即可顯示逐項差異。</p>
      {diff.themeChanged ? <p>樣式：{liveTheme?.description ?? '舊版樣式'} → {activeTheme.description}</p> : null}
      {diff.rebuilt ? <p>目前草稿已在上次發布後重新建立。</p> : null}
    </section></div> : null}
    {diff.mode === 'tracked' ? <>
      {!hasChanges ? <p class="muted">目前沒有待發布變更。</p> : <>
        <div class="publication-badges" aria-label="發布變更種類">
          {diff.added.length ? <span class="badge" data-variant="added">新增 {diff.added.length}</span> : null}
          {diff.updated.length ? <span class="badge" data-variant="updated">更新 {diff.updated.length}</span> : null}
          {diff.removed.length ? <span class="badge" data-variant="removed">移除 {diff.removed.length}</span> : null}
          {diff.identityChanges.length ? <span class="badge" data-variant="neutral">Blog 資訊</span> : null}
          {diff.themeChanged ? <span class="badge" data-variant="neutral">樣式</span> : null}
          {diff.rebuilt ? <span class="badge" data-variant="neutral">草稿重建</span> : null}
        </div>
        {diff.identityChanges.length ? <p>Blog 資訊：{diff.identityChanges.map((field) => identityLabels[field]).join('、')}已變更。</p> : null}
        {diff.themeChanged ? <p>樣式：{liveTheme?.description ?? '已發布樣式'} → {activeTheme.description}</p> : null}
        {diff.rebuilt ? <p>草稿已重新建立，包含 template 升級或輸出重建。</p> : null}
        {articleChangeCount ? <details class="publication-details" open>
          <summary>文章變更（{articleChangeCount}）</summary>
          <div class="publication-change-list">
            <PublicationArticles label="新增" posts={diff.added} variant="added"/>
            <PublicationArticles label="更新" posts={diff.updated} variant="updated"/>
            <PublicationArticles label="移除" posts={diff.removed} variant="removed"/>
          </div>
        </details> : null}
      </>}
    </> : null}
  </section>;
}

export function editorPage(input: EditorPageInput) {
  const { blog, themes, activeTheme, published, releases } = input;
  const controls = themeControlValues(activeTheme.config);
  const themesById = new Map(themes.map((theme) => [theme.id, theme]));
  const liveTheme = published ? themesById.get(published.themeRevisionId) : undefined;
  const busy = Boolean(input.operation && (input.operation.status === 'queued' || input.operation.status === 'running'));
  const hasChanges = !published || published.contentVersion !== blog.contentVersion || published.themeRevisionId !== activeTheme.id;
  const publication = !published
    ? { label: '尚未發布', variant: 'pending' }
    : hasChanges ? { label: '有未發布變更', variant: 'pending' } : { label: '已與線上版本同步', variant: 'live' };
  const publishLabel = !published ? '發布第一版' : hasChanges ? '發布變更' : '已是最新版本';
  const identityOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'identity' ? input.operation : undefined;
  const contentOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'content' ? input.operation : undefined;
  const selectionOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'selection' ? input.operation : undefined;
  const includedPosts = blog.contentManifest?.filter((post) => post.included).length ?? 0;

  return document('編輯 Blog', <div class="editor">
    <section class="controls" aria-label="Blog 控制">
      <header class="workspace-summary">
        <p class="workspace-kicker">Publishing workspace</p>
        <div class="workspace-title-row">
          <h1 class="workspace-title">{blog.title ?? blog.username}</h1>
          <span class="badge" data-variant={publication.variant}>{publication.label}</span>
        </div>
        <p class="workspace-meta">來源：@{blog.hackmdUsername} · {blog.state === 'syncing' ? '正在同步' : blog.lastError ? '上次同步失敗，現有草稿不受影響' : '內容已同步'}</p>
        {blog.lastError ? <div class="alert" data-variant="destructive" role="alert"><section>{blog.lastError}</section></div> : null}
        {published ? <div class="workspace-links"><a href={input.publicUrl} target="_blank" rel="noreferrer">查看已發布網站</a><span class="muted">上次發布：{new Date(published.createdAt).toLocaleString('zh-TW')}</span></div> : null}
      </header>

      <section class="card section-card">
        <header><h2>Blog 資訊</h2><p>套用到網站標題、搜尋摘要、Open Graph 與 RSS；儲存時也會取得最新 HackMD 內容。</p></header>
        <section><form method="post" action="/actions/blog/identity" data-operation aria-busy={identityOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <div class="field">
            <label for="blogTitle">Blog 標題</label>
            <input id="blogTitle" name="title" required minlength={1} maxlength={80} value={blog.title ?? ''} aria-describedby="blog-title-help" aria-errormessage="blog-title-error"/>
            <span id="blog-title-error" class="validation-error"><span aria-hidden="true">!</span> 請輸入 1–80 字元的標題。</span>
            <p id="blog-title-help">最多 80 字元。</p>
          </div>
          <div class="field">
            <label for="blogDescription">Blog 描述</label>
            <textarea id="blogDescription" name="description" maxlength={240} aria-describedby="blog-description-help">{blog.description ?? ''}</textarea>
            <p id="blog-description-help">最多 240 字元，可以留空。</p>
          </div>
          <button class="btn" type="submit" disabled={busy}>儲存並重建草稿</button>
          <OperationOutput operation={identityOperation}/>
        </form></section>
      </section>

      <section class="card section-card">
        <header><h2>同步內容</h2><p>{blog.lastSyncedAt ? <>上次成功同步：<time datetime={blog.lastSyncedAt}>{new Date(blog.lastSyncedAt).toLocaleString('zh-TW')}</time></> : '尚無同步摘要；重新同步後會顯示文章清單。'}</p></header>
        <section class="content-summary">
          {blog.contentManifest ? <form method="post" action="/actions/blog/selection" data-operation aria-busy={selectionOperation ? 'true' : undefined}>
            <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
            <details>
              <summary>已匯入文章（{blog.contentManifest.length}） · 已選取 {includedPosts}</summary>
              {blog.contentManifest.length > 0 ? <fieldset class="fieldset content-list">
                <legend>選擇要收錄到 Blog 的文章</legend>
                {blog.contentManifest.map((post) => <label class="content-choice">
                  <input type="checkbox" name={`article:${post.slug}`} value="included" checked={post.included}/>
                  <span class="content-choice-main">
                    <span>{post.title}</span>
                    <span class="content-dates">
                      發布於 <time datetime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('zh-TW')}</time>
                      {isUpdatedOnAnotherUtcDate(post.publishedAt, post.updatedAt)
                        ? <> · 更新於 <time datetime={post.updatedAt}>{new Date(post.updatedAt).toLocaleDateString('zh-TW')}</time></>
                        : null}
                    </span>
                    {(post.tags?.length ?? 0) > 0 ? <span class="content-tags" aria-label="文章主題">
                      {post.tags?.map((tag) => <span class="badge" data-variant="neutral">{tag.name}</span>)}
                    </span> : null}
                  </span>
                </label>)}
              </fieldset> : <p class="muted">這份摘要沒有文章。</p>}
            </details>
            <p class="field-hint">新同步到的公開文章會預設選取；變更只更新草稿，發布後才會上線。</p>
            <button class="btn" type="submit" disabled={busy || blog.contentManifest.length === 0}>儲存文章選擇並重建草稿</button>
            <OperationOutput operation={selectionOperation}/>
          </form> : null}
        </section>
        <footer><form class="stack" method="post" action="/actions/blog/sync" data-operation aria-busy={contentOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <button class="btn" data-variant="outline" type="submit" disabled={busy}>重新同步 HackMD</button>
          <OperationOutput operation={contentOperation}/>
        </form></footer>
      </section>

      <section class="card section-card studio-card">
        <header><p class="workspace-kicker">AI-first</p><h2>Theme Studio</h2><p>先描述閱讀感受，再用安全選項微調。AI 不會修改文章或寫入任意 CSS。</p></header>
        <section><form method="post" action="/actions/theme/apply" data-operation data-mixed-actions data-theme-studio>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <div class="field"><label for="prompt">描述你想要的感覺</label><textarea id="prompt" name="prompt" maxlength={1000} placeholder="例如：讓長文章讀起來像一本克制的獨立雜誌"></textarea></div>
          <div class="prompt-starters" aria-label="描述建議">
            {['更像一本克制的獨立雜誌', '提高長文閱讀舒適度', '保留極簡，但增加一點個性', '改成適合夜間閱讀的深色設計'].map((prompt) => <button class="btn prompt-chip" data-variant="secondary" data-size="compact" type="button" data-prompt-starter={prompt} aria-controls="prompt">{prompt}</button>)}
          </div>
          <button class="btn studio-primary-action" type="submit" formaction="/actions/theme/generate" data-operation-submit disabled={busy}>交給 AI 設計</button>

          <details class="theme-controls">
            <summary>手動微調安全樣式</summary>
            <div class="theme-control-stack">
              <ChoiceGroup legend="版面 preset" name="preset" options={CONTROL_OPTIONS.preset} value={controls.preset}/>
              <ChoiceGroup legend="頁首" name="headerStyle" options={CONTROL_OPTIONS.headerStyle} value={controls.headerStyle}/>
              <ChoiceGroup legend="文章列表" name="postListStyle" options={CONTROL_OPTIONS.postListStyle} value={controls.postListStyle}/>
              <ChoiceGroup legend="程式碼區塊" name="codeBlockStyle" options={CONTROL_OPTIONS.codeBlockStyle} value={controls.codeBlockStyle}/>
              <fieldset class="fieldset">
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
          <button class="btn" data-variant="outline" type="submit" disabled={busy}>儲存成新版本</button>
          <p class="unsaved-note" data-unsaved-note hidden>這些樣式尚未儲存；儲存後才能發布。</p>
          <OperationOutput operation={input.operation?.type === 'generate_theme' ? input.operation : undefined}/>
        </form></section>
      </section>

      <section class="card section-card">
        <header><h2>樣式版本</h2><p>每次 AI 或手動儲存都會保留為可切換的版本。</p></header>
        <section><details class="history">
          <summary>歷史樣式（{themes.length}）</summary>
          <div class="revision-list">{themes.map((theme) => <div class="revision">
            <div>
              <strong>{theme.description}</strong>
              <div class="markers">
                <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span>
                {theme.active ? <span class="badge" data-variant="pending">預覽中</span> : null}
                {published?.themeRevisionId === theme.id ? <span class="badge" data-variant="live">線上版本</span> : null}
              </div>
              <small class="muted">{new Date(theme.createdAt).toLocaleString('zh-TW')}</small>
            </div>
            {theme.active ? null : <form method="post" action={`/actions/theme/${theme.id}/activate`}>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy}>切換預覽</button>
            </form>}
          </div>)}</div>
        </details></section>
      </section>

      <section class="card section-card">
        <header><h2>發布</h2><p>發布會固定目前的內容與樣式，線上版本在下一次發布前不會改變。</p></header>
        <section><PublicationSummary blog={blog} activeTheme={activeTheme} published={published} liveTheme={liveTheme} hasChanges={hasChanges}/>
        <form class="stack" method="post" action="/actions/publish" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <button class="btn" type="submit" data-publish-button disabled={!blog.draftArtifact || !hasChanges || busy}>{publishLabel}到 {blog.username}.{input.appHostname}</button>
          <OperationOutput operation={input.operation?.type === 'publish' ? input.operation : undefined}/>
        </form>
        {releases.length > 0 ? <details class="history">
          <summary>發布紀錄（{releases.length}）</summary>
          <div class="revision-list">{releases.map((release) => {
            const theme = themesById.get(release.themeRevisionId);
            return <div class="revision">
              <div>
                <strong>{theme?.description ?? '已發布樣式'}</strong>
                <div class="markers">
                  {theme ? <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span> : null}
                  {release.active ? <span class="badge" data-variant="live">目前線上</span> : null}
                </div>
                <small class="muted">{new Date(release.createdAt).toLocaleString('zh-TW')}</small>
              </div>
              {release.active ? null : <form method="post" action={`/actions/releases/${release.id}/activate`}>
                <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
                <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy}>還原為線上版本</button>
              </form>}
            </div>;
          })}</div>
        </details> : null}</section>
      </section>
    </section>

    <section class="preview-panel" aria-label="Blog 預覽">
      <div class="preview-heading"><div><p class="preview-label">Draft preview</p><small class="muted">樣式可即時更新，內容同步才會重建</small></div></div>
      <div class="preview-frame">
        <div class="preview-chrome">{blog.username}.{input.appHostname}</div>
        {input.previewUrl
          ? <iframe class="preview" src={input.previewUrl} data-preview-url={input.previewUrl} title={`${blog.title ?? blog.username} 的即時預覽`} sandbox="allow-same-origin"></iframe>
          : <div class="preview-empty card"><section><p>內容同步完成後，預覽會出現在這裡。</p></section></div>}
      </div>
    </section>
  </div>, input.session, true);
}

export function operationPage(session: AppSession, operation: OperationRecord, backUrl: string) {
  const pending = operation.status === 'queued' || operation.status === 'running';
  const label = operationLabel(operation);
  return document(label, <section class="auth-shell card">
    <header><p class="auth-kicker">Background operation</p><h1>{label}</h1><p>可以停留在這裡等待，或稍後回到編輯器查看結果。</p></header>
    <section class="stack">
    <output
      class="alert operation-status"
      data-variant={operation.status === 'failed' ? 'destructive' : undefined}
      aria-live="polite"
      tabindex={-1}
      data-operation-status
      data-poll-url={pending ? `/api/operations/${operation.id}` : undefined}
      data-success-url="/editor"
    >{operationMessage(operation)}</output>
    {pending ? <p><a href={`/operations/${operation.id}`}>重新整理狀態</a></p> : null}
    <p><a href={backUrl}>{operation.status === 'failed' ? '返回並重試' : '返回編輯器'}</a></p>
    </section>
  </section>, session, true);
}
