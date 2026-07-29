import type { AppSession } from './auth.js';
import type { BlogRecord, OperationRecord, PublishedReleaseRecord, SyncedPostSummary, ThemeRevisionRecord } from './database.js';
import { syncOperationIntent } from './blog-sync.js';
import { operationLabel, operationMessage } from './operation-status.js';
import { calculatePublicationDiff } from './publication-diff.js';
import { THEME_PALETTES, themeControlValues } from './theme-studio.js';

export function document(title: string, content: unknown, session?: AppSession, editor = false) {
  return <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>{title} · VibeLog</title>
      <link rel="stylesheet" href="/assets/app.css"/>
    </head>
    <body>
      <div class="app-shell">
        <header class="app-header">
          <a class="app-brand" href={session ? '/editor' : '/'}>VibeLog</a>
          {session ? <nav class="account-nav" aria-label="Account">
            <a class="btn" data-variant="ghost" data-size="compact" href="/auth/change-password">Change password</a>
            <form method="post" action="/auth/logout">
              <input type="hidden" name="csrfToken" value={session.csrfToken}/>
              <button class="btn" data-variant="outline" data-size="compact" type="submit">Sign out</button>
            </form>
          </nav> : null}
        </header>
        <main class="app-main">{content}</main>
      </div>
      {editor ? <script type="module" src="/assets/client.js"></script> : null}
    </body>
  </html>;
}

export function landingPage() {
  return document('Publish your HackMD as a blog', <section class="landing">
    <header class="landing-hero">
      <p class="auth-kicker">Invite-only beta</p>
      <h1>Keep writing in HackMD.<br/>Publish a real blog.</h1>
      <p class="landing-intro">VibeLog turns your public HackMD articles into a fast static site without moving your writing workflow.</p>
      <div class="landing-actions">
        <a class="btn" href="/auth/register">Use an invite</a>
        <a class="btn" data-variant="outline" href="/auth/login">Sign in</a>
      </div>
    </header>
    <ul class="landing-points">
      <li><strong>Keep your workflow</strong><span>Write and publish in HackMD as usual.</span></li>
      <li><strong>Ship a fast static blog</strong><span>Get RSS, metadata, archives, and a username subdomain.</span></li>
      <li><strong>Preview and roll back safely</strong><span>Review every draft, then restore any retained release. AI themes stay optional.</span></li>
    </ul>
  </section>);
}

export function loginPage(message?: string) {
  return document('Sign in', <section class="auth-shell card">
    <header><p class="auth-kicker">Publishing desk</p><h1>Return to your blog</h1><p>Sign in to sync, preview, and publish.</p></header>
    <section class="stack">
      {message ? <div class="alert" data-variant="destructive" role="alert"><section>{message}</section></div> : null}
      <form class="stack" method="post" action="/auth/login">
        <div class="field"><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} autocomplete="username" autofocus/></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required maxlength={128} autocomplete="current-password"/></div>
        <button class="btn" type="submit">Sign in</button>
      </form>
    </section>
    <footer><a href="/auth/register">Create an account with an invite</a></footer>
  </section>);
}

export function registerPage(message?: string) {
  return document('Create account', <section class="auth-shell card">
    <header><p class="auth-kicker">Invite-only beta</p><h1>Create your VibeLog</h1><p>Your username becomes your permanent blog URL.</p></header>
    <section class="stack">
      {message ? <div class="alert" data-variant="destructive" role="alert"><section>{message}</section></div> : null}
      <form class="stack" method="post" action="/auth/register">
        <div class="field"><label for="inviteCode">Beta invite code</label><input id="inviteCode" name="inviteCode" type="password" required autocomplete="off"/></div>
        <div class="field"><label for="username">Username</label><input id="username" name="username" required minlength={3} maxlength={32} pattern="[A-Za-z0-9_-]+" autocomplete="username"/><p>3–32 letters, numbers, underscores, or hyphens.</p></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/><p>At least 12 characters. This beta has no password recovery.</p></div>
        <button class="btn" type="submit">Create account</button>
      </form>
    </section>
    <footer><a href="/auth/login">Back to sign in</a></footer>
  </section>);
}

export function changePasswordPage(session: AppSession) {
  return document('Change password', <section class="auth-shell card">
    <header><p class="auth-kicker">Account security</p><h1>Change password</h1><p>This signs out your other sessions.</p></header>
    <section><form class="stack" method="post" action="/auth/change-password">
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <div class="field"><label for="currentPassword">Current password</label><input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password"/></div>
      <div class="field"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" required minlength={12} maxlength={128} autocomplete="new-password"/></div>
      <button class="btn" type="submit">Update password</button>
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
  return document('Connect HackMD', <section class="auth-shell card">
    <header><p class="auth-kicker">Step 1 of 1</p><h1>Connect your HackMD</h1><p id="hackmd-help">Enter a public HackMD username. VibeLog imports only published articles anyone can read.</p></header>
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
      <div class="field"><label for="blogLanguage">Blog language</label><input id="blogLanguage" name="language" required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*" value={blog?.language ?? 'en'} aria-describedby="blog-language-help"/><p id="blog-language-help">A BCP 47 tag such as en, en-US, or zh-Hant.</p></div>
      <button class="btn" type="submit" disabled={busy}>{blog ? 'Retry sync' : 'Sync and build preview'}</button>
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

const SOURCE_LABEL = { system: 'Initial', ai: 'AI', manual: 'Manual' } as const;

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
  const identityLabels = { title: 'title', description: 'description', author: 'author', language: 'language' } as const;

  return <section class="publication-summary" aria-labelledby="publication-summary-title">
    <h3 id="publication-summary-title">This release includes</h3>
    {diff.mode === 'first' ? <div class="publication-copy">
      <p><strong>Your first release</strong> includes {diff.includedCount} articles.</p>
      <p>Theme: {activeTheme.description}</p>
    </div> : null}
    {diff.mode === 'legacy' ? <div class="alert"><section>
      <p>This live release predates change tracking. Publish again to enable itemized diffs.</p>
      {diff.themeChanged ? <p>Theme: {liveTheme?.description ?? 'Previous theme'} → {activeTheme.description}</p> : null}
      {diff.rebuilt ? <p>The draft was rebuilt after the last release.</p> : null}
    </section></div> : null}
    {diff.mode === 'tracked' ? <>
      {!hasChanges ? <p class="muted">There are no unpublished changes.</p> : <>
        <div class="publication-badges" aria-label="Release change types">
          {diff.added.length ? <span class="badge" data-variant="added">Added {diff.added.length}</span> : null}
          {diff.updated.length ? <span class="badge" data-variant="updated">Updated {diff.updated.length}</span> : null}
          {diff.removed.length ? <span class="badge" data-variant="removed">Removed {diff.removed.length}</span> : null}
          {diff.identityChanges.length ? <span class="badge" data-variant="neutral">Blog details</span> : null}
          {diff.themeChanged ? <span class="badge" data-variant="neutral">Theme</span> : null}
          {diff.rebuilt ? <span class="badge" data-variant="neutral">Draft rebuilt</span> : null}
        </div>
        {diff.identityChanges.length ? <p>Blog {diff.identityChanges.map((field) => identityLabels[field]).join(', ')} changed.</p> : null}
        {diff.themeChanged ? <p>Theme: {liveTheme?.description ?? 'Published theme'} → {activeTheme.description}</p> : null}
        {diff.rebuilt ? <p>The draft was rebuilt, including template upgrades.</p> : null}
        {articleChangeCount ? <details class="publication-details" open>
          <summary>Article changes ({articleChangeCount})</summary>
          <div class="publication-change-list">
            <PublicationArticles label="Added" posts={diff.added} variant="added"/>
            <PublicationArticles label="Updated" posts={diff.updated} variant="updated"/>
            <PublicationArticles label="Removed" posts={diff.removed} variant="removed"/>
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
    ? { label: 'Not published', variant: 'pending' }
    : hasChanges ? { label: 'Unpublished changes', variant: 'pending' } : { label: 'Live version is current', variant: 'live' };
  const publishLabel = !published ? 'Publish first release' : hasChanges ? 'Publish changes' : 'Already current';
  const identityOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'identity' ? input.operation : undefined;
  const contentOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'content' ? input.operation : undefined;
  const selectionOperation = input.operation?.type === 'sync' && syncOperationIntent(input.operation.payload) === 'selection' ? input.operation : undefined;
  const includedPosts = blog.contentManifest?.filter((post) => post.included).length ?? 0;

  return document('Edit blog', <div class="editor">
    <section class="controls" aria-label="Blog controls">
      <header class="workspace-summary">
        <p class="workspace-kicker">Publishing workspace</p>
        <div class="workspace-title-row">
          <h1 class="workspace-title">{blog.title ?? blog.username}</h1>
          <span class="badge" data-variant={publication.variant}>{publication.label}</span>
        </div>
        <p class="workspace-meta">Source: @{blog.hackmdUsername} · {blog.state === 'syncing' ? 'Syncing' : blog.lastError ? 'Last sync failed; the existing draft is safe' : 'Content synced'}</p>
        {blog.lastError ? <div class="alert" data-variant="destructive" role="alert"><section>{blog.lastError}</section></div> : null}
        {published ? <div class="workspace-links"><a href={input.publicUrl} target="_blank" rel="noreferrer">View published site</a><span class="muted">Last published: {new Date(published.createdAt).toLocaleString('en')}</span></div> : null}
      </header>

      <section class="card section-card">
        <header><h2>Blog details</h2><p>Used by the site title, search metadata, Open Graph, RSS, and document language. Saving also fetches the latest HackMD content.</p></header>
        <section><form method="post" action="/actions/blog/identity" data-operation aria-busy={identityOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <div class="field">
            <label for="blogTitle">Blog title</label>
            <input id="blogTitle" name="title" required minlength={1} maxlength={80} value={blog.title ?? ''} aria-describedby="blog-title-help" aria-errormessage="blog-title-error"/>
            <span id="blog-title-error" class="validation-error"><span aria-hidden="true">!</span> Enter a title between 1 and 80 characters.</span>
            <p id="blog-title-help">Up to 80 characters.</p>
          </div>
          <div class="field">
            <label for="blogDescription">Blog description</label>
            <textarea id="blogDescription" name="description" maxlength={240} aria-describedby="blog-description-help">{blog.description ?? ''}</textarea>
            <p id="blog-description-help">Up to 240 characters; optional.</p>
          </div>
          <div class="field"><label for="blogLanguage">Blog language</label><input id="blogLanguage" name="language" required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*" value={blog.language} aria-describedby="blog-language-help"/><p id="blog-language-help">A BCP 47 tag such as en, en-US, or zh-Hant.</p></div>
          <button class="btn" type="submit" disabled={busy}>Save and rebuild draft</button>
          <OperationOutput operation={identityOperation}/>
        </form></section>
      </section>

      <section class="card section-card">
        <header><h2>Sync content</h2><p>{blog.lastSyncedAt ? <>Last successful sync: <time datetime={blog.lastSyncedAt}>{new Date(blog.lastSyncedAt).toLocaleString('en')}</time></> : 'No sync summary yet. Sync to load the article list.'}</p></header>
        <section class="content-summary">
          {blog.contentManifest ? <form method="post" action="/actions/blog/selection" data-operation aria-busy={selectionOperation ? 'true' : undefined}>
            <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
            <details>
              <summary>Imported articles ({blog.contentManifest.length}) · {includedPosts} selected</summary>
              {blog.contentManifest.length > 0 ? <fieldset class="fieldset content-list">
                <legend>Select articles for the blog</legend>
                {blog.contentManifest.map((post) => <label class="content-choice">
                  <input type="checkbox" name={`article:${post.slug}`} value="included" checked={post.included}/>
                  <span class="content-choice-main">
                    <span>{post.title}</span>
                    <span class="content-dates">
                      Published <time datetime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('en')}</time>
                      {isUpdatedOnAnotherUtcDate(post.publishedAt, post.updatedAt)
                        ? <> · Updated <time datetime={post.updatedAt}>{new Date(post.updatedAt).toLocaleDateString('en')}</time></>
                        : null}
                    </span>
                    {(post.tags?.length ?? 0) > 0 ? <span class="content-tags" aria-label="Article topics">
                      {post.tags?.map((tag) => <span class="badge" data-variant="neutral">{tag.name}</span>)}
                    </span> : null}
                  </span>
                </label>)}
              </fieldset> : <p class="muted">This sync contains no articles.</p>}
            </details>
            <p class="field-hint">New public articles are selected by default. Changes affect only the draft until you publish.</p>
            <button class="btn" type="submit" disabled={busy || blog.contentManifest.length === 0}>Save selection and rebuild draft</button>
            <OperationOutput operation={selectionOperation}/>
          </form> : null}
        </section>
        <footer><form class="stack" method="post" action="/actions/blog/sync" data-operation aria-busy={contentOperation ? 'true' : undefined}>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <button class="btn" data-variant="outline" type="submit" disabled={busy}>Sync HackMD again</button>
          <OperationOutput operation={contentOperation}/>
        </form></footer>
      </section>

      <section class="card section-card studio-card">
        <header><p class="workspace-kicker">Optional AI</p><h2>Theme Studio</h2><p>Describe the reading experience, then refine it with safe controls. AI never edits articles or writes arbitrary CSS.</p></header>
        <section><form method="post" action="/actions/theme/apply" data-operation data-mixed-actions data-theme-studio>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <div class="field"><label for="prompt">Describe the feel you want</label><textarea id="prompt" name="prompt" maxlength={1000} placeholder="For example: make long articles feel like a restrained independent magazine"></textarea></div>
          <div class="prompt-starters" aria-label="Prompt suggestions">
            {['A restrained independent magazine', 'Make long articles easier to read', 'Keep it minimal but add personality', 'A dark theme for night reading'].map((prompt) => <button class="btn prompt-chip" data-variant="secondary" data-size="compact" type="button" data-prompt-starter={prompt} aria-controls="prompt">{prompt}</button>)}
          </div>
          <button class="btn studio-primary-action" type="submit" formaction="/actions/theme/generate" data-operation-submit disabled={busy}>Generate with AI</button>

          <details class="theme-controls">
            <summary>Adjust safe theme controls</summary>
            <div class="theme-control-stack">
              <ChoiceGroup legend="Layout preset" name="preset" options={CONTROL_OPTIONS.preset} value={controls.preset}/>
              <ChoiceGroup legend="Header" name="headerStyle" options={CONTROL_OPTIONS.headerStyle} value={controls.headerStyle}/>
              <ChoiceGroup legend="Article list" name="postListStyle" options={CONTROL_OPTIONS.postListStyle} value={controls.postListStyle}/>
              <ChoiceGroup legend="Code blocks" name="codeBlockStyle" options={CONTROL_OPTIONS.codeBlockStyle} value={controls.codeBlockStyle}/>
              <fieldset class="fieldset">
                <legend>Color palette</legend>
                {!controls.palette ? <p class="muted">The current palette came from AI. Choose one below to replace it.</p> : null}
                <div class="choice-grid">{Object.entries(THEME_PALETTES).map(([name, palette]) => <label class={`choice palette-choice palette-${name}`}>
                  <span class="palette-label"><input type="radio" name="palette" value={name} checked={controls.palette === name} data-theme-control/> {palette.label}</span>
                  <span class="swatches" aria-hidden="true"><span class="swatch"></span><span class="swatch"></span><span class="swatch"></span></span>
                </label>)}</div>
              </fieldset>
              <ChoiceGroup legend="Body font" name="bodyFont" options={CONTROL_OPTIONS.bodyFont} value={controls.bodyFont}/>
              <ChoiceGroup legend="Heading font" name="headingFont" options={CONTROL_OPTIONS.headingFont} value={controls.headingFont}/>
              <ChoiceGroup legend="Type scale" name="scale" options={CONTROL_OPTIONS.scale} value={controls.scale}/>
              <ChoiceGroup legend="Content width" name="contentWidth" options={CONTROL_OPTIONS.contentWidth} value={controls.contentWidth}/>
              <ChoiceGroup legend="Spacing" name="density" options={CONTROL_OPTIONS.density} value={controls.density}/>
              <ChoiceGroup legend="Corners" name="radius" options={CONTROL_OPTIONS.radius} value={controls.radius}/>
            </div>
          </details>
          <button class="btn" data-variant="outline" type="submit" disabled={busy}>Save as a new version</button>
          <p class="unsaved-note" data-unsaved-note hidden>These theme changes are not saved. Save before publishing.</p>
          <OperationOutput operation={input.operation?.type === 'generate_theme' ? input.operation : undefined}/>
        </form></section>
      </section>

      <section class="card section-card">
        <header><h2>Theme versions</h2><p>Every AI or manual save stays available as a version you can preview.</p></header>
        <section><details class="history">
          <summary>Theme history ({themes.length})</summary>
          <div class="revision-list">{themes.map((theme) => <div class="revision">
            <div>
              <strong>{theme.description}</strong>
              <div class="markers">
                <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span>
                {theme.active ? <span class="badge" data-variant="pending">Previewing</span> : null}
                {published?.themeRevisionId === theme.id ? <span class="badge" data-variant="live">Published</span> : null}
              </div>
              <small class="muted">{new Date(theme.createdAt).toLocaleString('zh-TW')}</small>
            </div>
            {theme.active ? null : <form method="post" action={`/actions/theme/${theme.id}/activate`}>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy}>Preview this version</button>
            </form>}
          </div>)}</div>
        </details></section>
      </section>

      <section class="card section-card">
        <header><h2>Publish</h2><p>Publishing freezes the current content and theme. The live site stays unchanged until the next release.</p></header>
        <section><PublicationSummary blog={blog} activeTheme={activeTheme} published={published} liveTheme={liveTheme} hasChanges={hasChanges}/>
        <form class="stack" method="post" action="/actions/publish" data-operation>
          <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
          <input type="hidden" name="previewToken" value={input.previewToken}/>
          <button class="btn" type="submit" data-publish-button disabled={!blog.draftArtifact || !hasChanges || busy}>{publishLabel} to {blog.username}.{input.appHostname}</button>
          <OperationOutput operation={input.operation?.type === 'publish' ? input.operation : undefined}/>
        </form>
        {releases.length > 0 ? <details class="history">
          <summary>Release history ({releases.length}/20)</summary>
          <div class="revision-list">{releases.map((release) => {
            const theme = themesById.get(release.themeRevisionId);
            return <div class="revision">
              <div>
                <strong>{theme?.description ?? 'Published theme'}</strong>
                <div class="markers">
                  {theme ? <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span> : null}
                  {release.active ? <span class="badge" data-variant="live">Live now</span> : null}
                </div>
                <small class="muted">{new Date(release.createdAt).toLocaleString('zh-TW')}</small>
              </div>
              {release.active ? null : <form method="post" action={`/actions/releases/${release.id}/activate`}>
                <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
                <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy}>Restore as live</button>
              </form>}
            </div>;
          })}</div>
        </details> : null}</section>
      </section>
    </section>

    <section class="preview-panel" aria-label="Blog preview">
      <div class="preview-heading"><div><p class="preview-label">Draft preview</p><small class="muted">Theme controls update live; content changes require a sync.</small></div></div>
      <div class="preview-frame">
        <div class="preview-chrome">{blog.username}.{input.appHostname}</div>
        {input.previewUrl
          ? <iframe class="preview" src={input.previewUrl} data-preview-url={input.previewUrl} title={`Live preview of ${blog.title ?? blog.username}`} sandbox="allow-same-origin"></iframe>
          : <div class="preview-empty card"><section><p>Your preview appears here after the first content sync.</p></section></div>}
      </div>
    </section>
  </div>, input.session, true);
}

export function operationPage(session: AppSession, operation: OperationRecord, backUrl: string) {
  const pending = operation.status === 'queued' || operation.status === 'running';
  const label = operationLabel(operation);
  return document(label, <section class="auth-shell card">
    <header><p class="auth-kicker">Background operation</p><h1>{label}</h1><p>Wait here or return to the editor and check again later.</p></header>
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
    {pending ? <p><a href={`/operations/${operation.id}`}>Refresh status</a></p> : null}
    <p><a href={backUrl}>{operation.status === 'failed' ? 'Go back and retry' : 'Back to editor'}</a></p>
    </section>
  </section>, session, true);
}
