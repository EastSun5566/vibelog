import type { AppSession } from './auth.js';
import type { BlogRecord, OperationRecord, PublishedReleaseRecord, SyncedPostSummary, ThemeRevisionRecord } from './database.js';
import { syncOperationIntent } from './blog-sync.js';
import { operationLabel, operationMessage, operationProgress } from './operation-status.js';
import { editorUrlWithPreviewPath } from './preview-path.js';
import { calculatePublicationDiff } from './publication-diff.js';
import { THEME_PALETTES, themeControlValues } from './theme-studio.js';

export function document(title: string, content: unknown, session?: AppSession, editor = false) {
  return <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <meta name="description" content="Turn public HackMD articles into a fast, customizable blog."/>
      <title>{title} · VibeLog</title>
      <link rel="icon" type="image/svg+xml" href="/assets/logo.svg"/>
      <link rel="stylesheet" href="/assets/app.css"/>
    </head>
    <body>
      <a class="app-skip-link" href="#main-content">Skip to content</a>
      <div class="app-shell">
        <header class="app-header">
          <a class="app-brand" href={session ? '/editor' : '/'}><img src="/assets/logo.svg" width="28" height="28" alt="" aria-hidden="true"/><span>VibeLog</span></a>
          <nav class="account-nav" aria-label={session ? 'Account' : 'Site'}>
            <a class="btn" data-variant="ghost" data-size="compact" href="/guide">Guide</a>
          {session ? <>
            <form method="post" action="/auth/logout">
              <input type="hidden" name="csrfToken" value={session.csrfToken}/>
              <button class="btn" data-variant="outline" data-size="compact" type="submit">Sign out</button>
            </form>
          </> : <a class="btn" data-variant="outline" data-size="compact" href="/auth/login">Sign in</a>}
          </nav>
        </header>
        <main class="app-main" id="main-content" tabindex={-1}>{content}</main>
      </div>
      {editor ? <script type="module" src="/assets/client.js"></script> : null}
    </body>
  </html>;
}

export function landingPage() {
  return document('Publish your HackMD as a blog', <>
    <section class="landing">
      <header class="landing-hero">
        <p class="auth-kicker">Open beta</p>
        <h1>Keep writing in HackMD.<br/>Publish a real blog.</h1>
        <p class="landing-intro">Turn your public articles into a fast, customizable site without moving your writing workflow.</p>
        <div class="landing-actions">
          <a class="btn" href="/auth/login">Start publishing</a>
        </div>
      </header>
      <ul class="landing-points">
        <li><strong>Keep your workflow</strong><span>Write and publish in HackMD as usual.</span></li>
        <li><strong>Review before publishing</strong><span>Content changes stay in a private preview until you approve them.</span></li>
        <li><strong>Make it yours</strong><span>Choose a theme, publish to your subdomain, and restore earlier releases.</span></li>
      </ul>
    </section>
    <footer class="landing-footer">
      <a class="github-link" href="https://github.com/EastSun5566/vibelog" target="_blank" rel="noreferrer" aria-label="VibeLog source code on GitHub" title="VibeLog is open source on GitHub">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.71.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.97-.82-1.16-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.02 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.45 7.45 0 0 1 8 3.91c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.81-3.65 4.02.29.25.54.74.54 1.5 0 1.08-.01 1.95-.01 2.22 0 .22.15.47.55.39A8.14 8.14 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z"/></svg>
      </a>
    </footer>
  </>);
}

export function loginPage(input: { github: boolean; google: boolean; message?: string; sent?: boolean }) {
  const hasSocialLogin = input.github || input.google;
  if (input.sent) return document('Check your email', <section class="auth-shell card">
    <header><p class="auth-kicker">One more step</p><h1>Check your email</h1></header>
    <section class="stack">
      <div class="alert" role="status"><section>We sent a one-time sign-in link. It expires in 10 minutes.</section></div>
      <p class="muted">You can close this tab after opening the link.</p>
      <a href="/auth/login">Use a different email</a>
    </section>
  </section>);
  return document('Sign in', <section class="auth-shell card">
    <header><p class="auth-kicker">Welcome back</p><h1>Sign in to VibeLog</h1><p>{hasSocialLogin ? 'Choose an account or use a one-time email link.' : 'We’ll email you a one-time sign-in link.'}</p></header>
    <section class="stack">
      {input.message ? <div class="alert" data-variant="destructive" role="alert"><section>{input.message}</section></div> : null}
      {input.github ? <form method="post" action="/auth/oauth/github"><button class="btn" data-variant="outline" type="submit">Continue with GitHub</button></form> : null}
      {input.google ? <form method="post" action="/auth/oauth/google"><button class="btn" data-variant="outline" type="submit">Continue with Google</button></form> : null}
      <form class="stack" method="post" action="/auth/magic-link">
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required maxlength={320} autocomplete="email"/></div>
        <button class="btn" type="submit">Email me a sign-in link</button>
      </form>
    </section>
  </section>);
}

export function guidePage(session?: AppSession) {
  return document('Guide', <article class="guide">
    <header>
      <p class="auth-kicker">Writer guide</p>
      <h1>From HackMD to your own blog</h1>
      <p>Connect your public writing, review the result, and decide when it goes live.</p>
      <a class="btn" href={session ? '/editor' : '/auth/login'}>{session ? 'Open your editor' : 'Start publishing'}</a>
    </header>
    <section aria-labelledby="first-release">
      <h2 id="first-release">Publish your first release</h2>
      <ol>
        <li>Connect a public HackMD profile and choose a blog address.</li>
        <li>Choose articles, set the blog details, and review the private preview.</li>
        <li>Generate a theme with AI or fine-tune it, then publish when the draft is ready.</li>
      </ol>
      <p>Only public, published HackMD notes are imported. A failed sync never replaces the last working draft or live release.</p>
    </section>
    <section aria-labelledby="updates">
      <h2 id="updates">Update and restore safely</h2>
      <p>Syncing rebuilds only the draft. Publishing is always explicit, and release history lets you restore an earlier live version without changing your draft.</p>
    </section>
    <section aria-labelledby="ai-privacy">
      <h2 id="ai-privacy">AI themes and privacy</h2>
      <p>AI receives only your blog identity, current theme, and design prompt. Article bodies are never sent to the AI provider.</p>
    </section>
  </article>, session);
}

function OperationOutput({ operation, successUrl, feedbackKey }: { operation?: OperationRecord; successUrl?: string; feedbackKey?: string }) {
  const pending = operation && (operation.status === 'queued' || operation.status === 'running');
  const progress = operation ? operationProgress(operation) : null;
  const state = operation?.status ?? 'idle';
  return <div class="operation-feedback" data-operation-feedback data-feedback-slot={feedbackKey} data-state={state}>
    <div class="operation-status-row">
      <span class="operation-indicator" aria-hidden="true"></span>
      <output
        class="operation-status"
        data-variant={operation?.status === 'failed' ? 'destructive' : undefined}
        aria-live="polite"
        tabindex={-1}
        data-operation-status
        data-poll-url={pending ? `/api/operations/${operation.id}` : undefined}
        data-success-url={successUrl}
      >{operation ? operationMessage(operation) : ''}</output>
    </div>
    <progress
      data-operation-progress
      aria-label="Operation progress"
      hidden={progress?.kind !== 'determinate'}
      max={progress?.kind === 'determinate' ? progress.max : undefined}
      value={progress?.kind === 'determinate' ? progress.value : undefined}
    ></progress>
  </div>;
}

const LANGUAGE_SUGGESTIONS = ['en', 'en-US', 'en-GB', 'zh-Hant', 'zh-Hans', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'it'];

function BlogLanguageField({ value, id, listId }: { value: string; id: string; listId: string }) {
  const helpId = `${id}-help`;
  return <div class="field"><label for={id}>Blog language</label><input id={id} name="language" required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*" value={value} list={listId} autocomplete="off" autocapitalize="none" spellcheck={false} aria-describedby={helpId}/><datalist id={listId}>{LANGUAGE_SUGGESTIONS.map((language) => <option value={language}/>)}</datalist><p id={helpId}>Choose a suggestion or enter any valid language tag.</p></div>;
}

function PreviewPathInput({ value }: { value: string }) {
  return <input type="hidden" name="previewPath" value={value} data-preview-path-input/>;
}

export function onboardingPage(session: AppSession, blog: BlogRecord | null, operation: OperationRecord | null, appHostname: string) {
  const failed = blog?.state === 'failed' ? blog.lastError : null;
  const busy = operation?.status === 'queued' || operation?.status === 'running';
  return document('Connect HackMD', <section class="auth-shell card">
    <header><p class="auth-kicker">Start publishing</p><h1>Connect your HackMD</h1><p id="hackmd-help">VibeLog imports only published articles anyone can read.</p></header>
    <section class="stack">
    {failed ? <div id="hackmd-error" class="alert" data-variant="destructive" role="alert"><section>{failed}</section></div> : null}
    <form class="stack" method="post" action="/actions/blog/connect" data-operation data-success-url="/editor" aria-busy={busy ? 'true' : undefined}>
      <input type="hidden" name="csrfToken" value={session.csrfToken}/>
      <div class="field"><label for="username">Blog address</label><input id="username" name="username" required minlength={3} maxlength={32} pattern="[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])" value={blog?.username ?? ''} readonly={Boolean(blog)} autocomplete="off" autocapitalize="none" spellcheck={false} data-blog-handle aria-errormessage="blog-address-error"/><span id="blog-address-error" class="inline-error" data-blog-address-error hidden></span><p>Your site will be <strong data-blog-hostname data-host-suffix={appHostname}>{blog?.username ?? 'your-name'}.{appHostname}</strong>.</p></div>
      <div class="field"><label for="hackmdUsername">HackMD username</label><input
        id="hackmdUsername"
        name="hackmdUsername"
        required
        maxlength={100}
        value={blog?.hackmdUsername ?? ''}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        aria-describedby={`hackmd-help${failed ? ' hackmd-error' : ''}`}
      /><p><a data-hackmd-profile href={blog?.hackmdUsername ? `https://hackmd.io/@${encodeURIComponent(blog.hackmdUsername)}` : undefined} aria-disabled={!blog?.hackmdUsername} target="_blank" rel="noreferrer">{blog?.hackmdUsername ? `https://hackmd.io/@${blog.hackmdUsername}` : 'https://hackmd.io/@username'}</a></p></div>
      <BlogLanguageField id="blogLanguage" listId="language-suggestions" value={blog?.language ?? 'en'}/>
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
  previewOrigin: string;
  previewPath: string;
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
        {articleChangeCount ? <details class="publication-details">
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
  const themeSuccessUrl = editorUrlWithPreviewPath(input.previewPath);

  return document('Edit blog', <><p class="visually-hidden" aria-live="polite" data-page-status></p><div class="editor" data-editor-root>
    <header class="workspace-summary">
      <div>
        <p class="workspace-kicker">Publishing workspace</p>
        <div class="workspace-title-row">
          <h1 class="workspace-title">{blog.title ?? blog.username}</h1>
          <span class="badge" data-variant={publication.variant}>{publication.label}</span>
        </div>
      </div>
      <div class="workspace-status">
        <p class="workspace-meta"><a href={`https://hackmd.io/@${encodeURIComponent(blog.hackmdUsername)}`} target="_blank" rel="noreferrer">@{blog.hackmdUsername} on HackMD</a> · {blog.state === 'syncing' ? 'Syncing' : blog.lastError ? 'Last sync failed; your existing draft is safe' : 'Content synced'}</p>
        {published ? <div class="workspace-links"><a href={input.publicUrl} target="_blank" rel="noreferrer">View live site</a><span class="muted">Published {new Date(published.createdAt).toLocaleString('en')}</span></div> : null}
      </div>
      {blog.lastError ? <div class="alert" data-variant="destructive" role="alert"><section>{blog.lastError}</section></div> : null}
    </header>

    <section class="preview-panel" aria-label="Blog preview">
      <div class="preview-heading">
        <div><p class="preview-label">Draft preview</p><small class="muted">Theme controls update here. Content changes require a sync.</small></div>
        <span class="preview-address">{blog.username}.{input.appHostname}</span>
      </div>
      <div class="preview-frame">
        {input.previewUrl
          ? <iframe class="preview" src={input.previewUrl} data-preview-url={input.previewUrl} data-preview-origin={input.previewOrigin} title={`Live preview of ${blog.title ?? blog.username}`} sandbox="allow-same-origin allow-scripts"></iframe>
          : <div class="preview-empty"><p>Your preview appears after the first content sync.</p><a href="#content">Go to content</a></div>}
      </div>
    </section>

    <section class="controls" aria-label="Blog controls">
      <section class="workflow-section" id="content" aria-labelledby="content-title">
        <header class="workflow-heading"><span class="step-number" aria-hidden="true">1</span><div><h2 id="content-title">Content</h2><p>Sync public articles and choose what belongs on your blog.</p></div></header>
        <div class="card workflow-card">
          <section class="action-row">
            <div><strong>HackMD source</strong><p class="muted">{blog.lastSyncedAt ? <>Last synced <time datetime={blog.lastSyncedAt}>{new Date(blog.lastSyncedAt).toLocaleString('en')}</time></> : 'No successful sync yet.'}</p></div>
            <form class="compact-stack action-form" method="post" action="/actions/blog/sync" data-operation aria-busy={contentOperation ? 'true' : undefined}>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <PreviewPathInput value={input.previewPath}/>
              <button class="btn" data-variant="outline" type="submit" disabled={busy} data-focus-key="sync">Sync now</button>
              <OperationOutput operation={contentOperation}/>
            </form>
          </section>

          {blog.contentManifest ? <details class="editor-disclosure" data-disclosure-key="articles">
            <summary><span>Articles</span><small>{includedPosts} of {blog.contentManifest.length} included</small></summary>
            <div class="disclosure-body"><form method="post" action="/actions/blog/selection" data-operation aria-busy={selectionOperation ? 'true' : undefined}>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <PreviewPathInput value={input.previewPath}/>
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
              <p class="field-hint">New public articles are included by default. Your live site changes only when you publish.</p>
              <button class="btn" type="submit" disabled={busy || blog.contentManifest.length === 0} data-focus-key="selection">Save article selection</button>
              <OperationOutput operation={selectionOperation}/>
            </form></div>
          </details> : null}

          <details class="editor-disclosure" data-disclosure-key="blog-details">
            <summary><span>Blog details</span><small>Title, description, and language</small></summary>
            <div class="disclosure-body"><form method="post" action="/actions/blog/identity" data-operation aria-busy={identityOperation ? 'true' : undefined}>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <PreviewPathInput value={input.previewPath}/>
              <div class="field">
                <label for="blogTitle">Blog title</label>
                <input id="blogTitle" name="title" required minlength={1} maxlength={80} value={blog.title ?? ''} aria-describedby="blog-title-help" aria-errormessage="blog-title-error"/>
                <span id="blog-title-error" class="validation-error"><span aria-hidden="true">!</span> Enter a title between 1 and 80 characters.</span>
                <p id="blog-title-help">Up to 80 characters.</p>
              </div>
              <div class="field">
                <label for="blogDescription">Blog description</label>
                <textarea id="blogDescription" name="description" maxlength={240} aria-describedby="blog-description-help">{blog.description ?? ''}</textarea>
                <p id="blog-description-help">Optional, up to 240 characters.</p>
              </div>
              <BlogLanguageField id="editorBlogLanguage" listId="editor-language-suggestions" value={blog.language}/>
              <button class="btn" type="submit" disabled={busy} data-focus-key="identity">Save blog details</button>
              <OperationOutput operation={identityOperation}/>
            </form></div>
          </details>
        </div>
      </section>

      <section class="workflow-section" id="appearance" aria-labelledby="appearance-title">
        <header class="workflow-heading"><span class="step-number" aria-hidden="true">2</span><div><h2 id="appearance-title">Appearance</h2><p>Keep the current theme or shape a new version.</p></div></header>
        <div class="card workflow-card">
          <section class="theme-summary"><div><strong>{activeTheme.description}</strong><p class="muted">Current draft theme</p></div><span class="badge" data-variant="neutral">{SOURCE_LABEL[activeTheme.source]}</span></section>
          <form method="post" action="/actions/theme/apply" data-operation data-editor-submit data-mixed-actions data-theme-studio>
            <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
            <input type="hidden" name="previewToken" value={input.previewToken}/>
            <PreviewPathInput value={input.previewPath}/>

            <section class="studio-primary">
              <header><strong>Generate with AI</strong><p>Start with a direction or write your own.</p></header>
              <div class="studio-primary-body">
                <div class="field"><label for="prompt">Describe the reading experience</label><textarea id="prompt" name="prompt" required minlength={1} maxlength={1000} placeholder="A restrained independent magazine for long articles" aria-describedby="prompt-help"></textarea><p id="prompt-help">AI sees your blog details, theme, and this prompt. It never receives article bodies.</p></div>
                <div class="prompt-starters" aria-label="Prompt starters">
                  {['A restrained independent magazine', 'Make long articles easier to read', 'Keep it minimal but add personality', 'A dark theme for night reading'].map((prompt) => <button class="btn prompt-chip" data-variant="outline" data-size="compact" type="button" data-prompt-starter={prompt}>{prompt}</button>)}
                </div>
                <button class="btn studio-primary-action" type="submit" formaction="/actions/theme/generate" data-operation-submit data-feedback-target="ai" data-focus-key="generate" aria-keyshortcuts="Meta+Enter Control+Enter" disabled={busy}>Generate with AI</button>
                <p class="shortcut-hint">⌘/Ctrl + Enter</p>
                <OperationOutput operation={input.operation?.type === 'generate_theme' ? input.operation : undefined} successUrl={themeSuccessUrl} feedbackKey="ai"/>
              </div>
            </section>

            <details class="editor-disclosure" data-disclosure-key="fine-tune">
              <summary><span>Fine-tune theme</span><small>Layout, type, color, and spacing</small></summary>
              <div class="disclosure-body theme-control-stack">
                <ChoiceGroup legend="Layout preset" name="preset" options={CONTROL_OPTIONS.preset} value={controls.preset}/>
                <ChoiceGroup legend="Header" name="headerStyle" options={CONTROL_OPTIONS.headerStyle} value={controls.headerStyle}/>
                <ChoiceGroup legend="Article list" name="postListStyle" options={CONTROL_OPTIONS.postListStyle} value={controls.postListStyle}/>
                <ChoiceGroup legend="Code blocks" name="codeBlockStyle" options={CONTROL_OPTIONS.codeBlockStyle} value={controls.codeBlockStyle}/>
                <fieldset class="fieldset">
                  <legend>Color palette</legend>
                  {!controls.palette ? <p class="muted">Choose a palette to replace the current AI colors.</p> : null}
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
                <button class="btn" type="submit" formnovalidate disabled={busy} data-editor-submit data-feedback-target="fine-tune" data-focus-key="save-theme">Save theme version</button>
                <OperationOutput feedbackKey="fine-tune"/>
              </div>
            </details>
            <p class="unsaved-note" data-unsaved-note hidden>Save these theme changes before publishing.</p>
          </form>

          <details class="editor-disclosure history" data-disclosure-key="theme-history">
            <summary><span>Theme history</span><small>{themes.length} versions</small></summary>
            <div class="disclosure-body revision-list">{themes.map((theme) => <div class="revision">
              <div>
                <strong>{theme.description}</strong>
                <div class="markers">
                  <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span>
                  {theme.active ? <span class="badge" data-variant="pending">Previewing</span> : null}
                  {published?.themeRevisionId === theme.id ? <span class="badge" data-variant="live">Published</span> : null}
                </div>
                <small class="muted">{new Date(theme.createdAt).toLocaleString('en')}</small>
              </div>
              {theme.active ? null : <form method="post" action={`/actions/theme/${theme.id}/activate`} data-editor-submit>
                <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
                <PreviewPathInput value={input.previewPath}/>
                <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy} data-focus-key="activate-theme">Preview version</button>
              </form>}
            </div>)}</div>
          </details>
        </div>
      </section>

      <section class="workflow-section" id="publish" aria-labelledby="publish-title">
        <header class="workflow-heading"><span class="step-number" aria-hidden="true">3</span><div><h2 id="publish-title">Publish</h2><p>Review the draft changes, then decide when they go live.</p></div></header>
        <div class="card workflow-card publish-card">
          <section><PublicationSummary blog={blog} activeTheme={activeTheme} published={published} liveTheme={liveTheme} hasChanges={hasChanges}/>
            <form class="stack" method="post" action="/actions/publish" data-operation>
              <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
              <input type="hidden" name="previewToken" value={input.previewToken}/>
              <PreviewPathInput value={input.previewPath}/>
              <button class="btn" type="submit" data-publish-button data-focus-key="publish" disabled={!blog.draftArtifactId || !hasChanges || busy}>{publishLabel}</button>
              <p class="publish-destination">{published
                ? <>Live at <a href={input.publicUrl} target="_blank" rel="noreferrer">{input.publicUrl}</a></>
                : <>Will publish at {input.publicUrl}</>}</p>
              <OperationOutput operation={input.operation?.type === 'publish' ? input.operation : undefined}/>
            </form>
          </section>
          {releases.length > 0 ? <details class="editor-disclosure history" data-disclosure-key="release-history">
            <summary><span>Release history</span><small>{releases.length} saved</small></summary>
            <div class="disclosure-body revision-list">{releases.map((release) => {
              const theme = themesById.get(release.themeRevisionId);
              return <div class="revision">
                <div>
                  <strong>{theme?.description ?? 'Published theme'}</strong>
                  <div class="markers">
                    {theme ? <span class="badge" data-variant="neutral">{SOURCE_LABEL[theme.source]}</span> : null}
                    {release.active ? <span class="badge" data-variant="live">Live now</span> : null}
                  </div>
                  <small class="muted">{new Date(release.createdAt).toLocaleString('en')}</small>
                </div>
                {release.active ? null : <form method="post" action={`/actions/releases/${release.id}/activate`} data-editor-submit>
                  <input type="hidden" name="csrfToken" value={input.session.csrfToken}/>
                  <PreviewPathInput value={input.previewPath}/>
                  <button class="btn" data-variant="outline" data-size="compact" type="submit" disabled={busy} data-focus-key="restore-release">Restore live</button>
                </form>}
              </div>;
            })}</div>
          </details> : null}
        </div>
      </section>
    </section>
  </div></>, input.session, true);
}

export function operationPage(session: AppSession, operation: OperationRecord, backUrl: string, successUrl = '/editor') {
  const pending = operation.status === 'queued' || operation.status === 'running';
  const label = operationLabel(operation);
  return document(label, <section class="auth-shell card">
    <header><p class="auth-kicker">Background operation</p><h1>{label}</h1><p>Wait here or return to the editor and check again later.</p></header>
    <section class="stack">
    <OperationOutput operation={operation} successUrl={successUrl}/>
    {pending ? <p><a href={`/operations/${operation.id}`}>Refresh status</a></p> : null}
    <p><a href={backUrl}>{operation.status === 'failed' ? 'Go back and retry' : 'Back to editor'}</a></p>
    </section>
  </section>, session, true);
}
