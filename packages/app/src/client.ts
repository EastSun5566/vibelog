export const CLIENT_SCRIPT = String.raw`
const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const readPayload = async (response) => {
  try { return await response.json(); }
  catch { return {}; }
};

const currentPreview = () => document.querySelector('iframe[data-preview-url]');
const currentPreviewOrigin = () => currentPreview()?.dataset.previewOrigin;
const safePreviewPath = (value) => {
  const origin = currentPreviewOrigin();
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || !origin) return '/';
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : '/';
  } catch { return '/'; }
};

let currentPreviewPath = '/';
const rememberPreviewPath = (value) => {
  currentPreviewPath = safePreviewPath(value);
  for (const input of document.querySelectorAll('[data-preview-path-input]')) input.value = currentPreviewPath;
};

addEventListener('message', (event) => {
  const preview = currentPreview();
  const origin = currentPreviewOrigin();
  if (!preview || !origin || event.origin !== new URL(origin).origin || event.source !== preview.contentWindow || event.data?.type !== 'vibelog-preview-location') return;
  rememberPreviewPath(event.data.path);
});

const editorUrl = new URL(location.href);
if (editorUrl.pathname === '/editor' && editorUrl.searchParams.has('previewPath')) {
  editorUrl.searchParams.delete('previewPath');
  history.replaceState(history.state, '', editorUrl.pathname + editorUrl.search + editorUrl.hash);
}

const showStatus = (node, message, state = 'running') => {
  if (!node) return;
  node.textContent = message;
  const feedback = node.closest('[data-operation-feedback]');
  if (feedback) feedback.dataset.state = message ? state : 'idle';
  if (state === 'failed') node.dataset.variant = 'destructive';
  else delete node.dataset.variant;
  if (state === 'failed') node.focus();
};

const feedbackStatus = (root, trigger) => {
  const key = trigger?.dataset.feedbackTarget;
  const feedback = key
    ? root.querySelector('[data-feedback-slot="' + CSS.escape(key) + '"]')
    : root.querySelector('[data-operation-feedback]');
  return feedback?.querySelector('[data-operation-status]');
};

const updateProgress = (statusNode, progress = { kind: 'indeterminate' }) => {
  const node = statusNode?.closest('[data-operation-feedback]')?.querySelector('[data-operation-progress]');
  if (!(node instanceof HTMLProgressElement)) return;
  const determinate = progress?.kind === 'determinate' && Number.isFinite(progress.value) && Number.isFinite(progress.max) && progress.max > 0;
  node.hidden = !determinate;
  if (determinate) {
    node.max = progress.max;
    node.value = Math.min(progress.max, Math.max(0, progress.value));
  } else node.removeAttribute('value');
};

const announce = (message) => {
  const node = document.querySelector('[data-page-status]');
  if (node) node.textContent = message;
};

const editorTargetUrl = (value = '/editor') => {
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || url.pathname !== '/editor') return new URL('/editor', location.origin);
  if (currentPreviewPath !== '/') url.searchParams.set('previewPath', currentPreviewPath);
  else url.searchParams.delete('previewPath');
  return url;
};

const editorState = (trigger) => ({
  scrollX: window.scrollX,
  scrollY: window.scrollY,
  disclosures: [...document.querySelectorAll('details[data-disclosure-key][open]')].map((item) => item.dataset.disclosureKey),
  focusKey: trigger?.dataset.focusKey,
  sectionId: trigger?.closest('.workflow-section')?.id,
});

const replaceEditor = (html, state) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const incoming = parsed.querySelector('[data-editor-root]');
  const current = document.querySelector('[data-editor-root]');
  if (!incoming || !current) throw new Error('Could not refresh the editor');
  current.replaceWith(incoming);
  for (const key of state.disclosures) incoming.querySelector('details[data-disclosure-key="' + CSS.escape(key) + '"]')?.setAttribute('open', '');
  initializeEditor(incoming);
  requestAnimationFrame(() => {
    window.scrollTo(state.scrollX, state.scrollY);
    const preferred = state.focusKey ? incoming.querySelector('[data-focus-key="' + CSS.escape(state.focusKey) + '"]') : null;
    const heading = state.sectionId ? incoming.querySelector('#' + CSS.escape(state.sectionId) + ' h2') : null;
    const target = preferred instanceof HTMLElement && !preferred.matches(':disabled') ? preferred : heading;
    if (target instanceof HTMLElement) {
      if (!target.hasAttribute('tabindex') && target === heading) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
  announce('Editor updated.');
};

const refreshEditor = async (successUrl, trigger, existingResponse) => {
  const state = editorState(trigger);
  try {
    const response = existingResponse ?? await fetch(editorTargetUrl(successUrl), { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    if (!response.ok || new URL(response.url).pathname !== '/editor') throw new Error('Could not refresh the editor');
    replaceEditor(await response.text(), state);
  } catch {
    window.location.assign(editorTargetUrl(successUrl));
  }
};

const unlockForm = (statusNode) => {
  const form = statusNode?.closest('form');
  form?.removeAttribute('aria-busy');
  for (const button of form?.querySelectorAll('button[type="submit"]') ?? []) button.disabled = false;
};

const poll = async (url, statusNode, successUrl = '/editor', trigger) => {
  while (true) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error?.message ?? 'Could not read progress');
    updateProgress(statusNode, payload.progress);
    showStatus(statusNode, payload.message ?? 'Working…', payload.status);
    if (payload.status === 'succeeded') {
      await sleep(350);
      if (document.querySelector('[data-editor-root]')) await refreshEditor(successUrl, trigger);
      else window.location.assign(successUrl);
      return 'succeeded';
    }
    if (payload.status === 'failed') return 'failed';
    await sleep(1000);
  }
};

const syncAriaInvalid = (control) => {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
  if (!control.checkValidity()) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
};

const initializeValidation = (root) => {
  for (const form of root.querySelectorAll('form')) {
    if (form.dataset.validationBound) continue;
    form.dataset.validationBound = 'true';
    form.addEventListener('invalid', (event) => syncAriaInvalid(event.target), true);
    form.addEventListener('blur', (event) => syncAriaInvalid(event.target), true);
    form.addEventListener('input', (event) => syncAriaInvalid(event.target));
    form.addEventListener('submit', () => { for (const control of form.elements) syncAriaInvalid(control); });
  }
};

const initializeHandles = (root) => {
  const blogHandle = root.querySelector('[data-blog-handle]');
  const blogHostname = root.querySelector('[data-blog-hostname]');
  if (blogHandle instanceof HTMLInputElement && blogHostname && !blogHandle.dataset.handleBound) {
    blogHandle.dataset.handleBound = 'true';
    const update = () => { blogHostname.textContent = (blogHandle.value.trim().toLowerCase() || 'your-name') + '.' + blogHostname.dataset.hostSuffix; };
    blogHandle.addEventListener('input', update);
    update();
  }
  const hackmdHandle = root.querySelector('#hackmdUsername');
  const hackmdProfile = root.querySelector('[data-hackmd-profile]');
  if (hackmdHandle instanceof HTMLInputElement && hackmdProfile instanceof HTMLAnchorElement && !hackmdHandle.dataset.profileBound) {
    hackmdHandle.dataset.profileBound = 'true';
    const update = () => {
      const username = hackmdHandle.value.trim();
      hackmdProfile.textContent = 'https://hackmd.io/@' + (username || 'username');
      if (username) { hackmdProfile.href = 'https://hackmd.io/@' + encodeURIComponent(username); hackmdProfile.removeAttribute('aria-disabled'); }
      else { hackmdProfile.removeAttribute('href'); hackmdProfile.setAttribute('aria-disabled', 'true'); }
    };
    hackmdHandle.addEventListener('input', update);
    update();
  }
};

const initializeOperations = (root) => {
  for (const form of root.querySelectorAll('form[data-operation]')) {
    if (form.dataset.operationBound) continue;
    form.dataset.operationBound = 'true';
    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (form.hasAttribute('data-mixed-actions') && !submitter?.hasAttribute('data-operation-submit')) return;
      event.preventDefault();
      const buttons = [...form.querySelectorAll('button[type="submit"]')];
      const button = submitter instanceof HTMLButtonElement ? submitter : buttons[0];
      const statusNode = feedbackStatus(form, button);
      const buttonLabel = button?.textContent;
      form.setAttribute('aria-busy', 'true');
      for (const item of buttons) item.disabled = true;
      if (button) button.textContent = 'Working…';
      rememberPreviewPath(currentPreviewPath);
      updateProgress(statusNode);
      showStatus(statusNode, 'Submitted and waiting…', 'queued');
      const action = button?.hasAttribute('formaction') ? button.formAction : form.action;
      void fetch(action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then(async (response) => {
          const payload = await readPayload(response);
          if (!response.ok || !payload.pollUrl) {
            if (payload.error?.code === 'blog_address_taken') {
              const input = form.querySelector('[data-blog-handle]');
              const error = form.querySelector('[data-blog-address-error]');
              input?.setAttribute('aria-invalid', 'true');
              if (error) { error.textContent = payload.error.message; error.hidden = false; }
            }
            throw new Error(payload.error?.message ?? 'Could not start the operation');
          }
          await poll(payload.pollUrl, statusNode, payload.successUrl ?? form.dataset.successUrl ?? '/editor', button);
        })
        .catch((error) => showStatus(statusNode, error instanceof Error ? error.message : 'The operation failed. Please try again.', 'failed'))
        .finally(() => {
          form.removeAttribute('aria-busy');
          for (const item of buttons) item.disabled = false;
          if (button) button.textContent = buttonLabel ?? 'Submit';
        });
    });
  }
};

const initializeEditorSubmits = (root) => {
  for (const form of root.querySelectorAll('form[data-editor-submit]')) {
    if (form.dataset.editorSubmitBound) continue;
    form.dataset.editorSubmitBound = 'true';
    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (submitter?.hasAttribute('data-operation-submit')) return;
      event.preventDefault();
      const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector('button[type="submit"]');
      const label = button?.textContent;
      form.setAttribute('aria-busy', 'true');
      if (button) { button.disabled = true; button.textContent = 'Saving…'; }
      rememberPreviewPath(currentPreviewPath);
      void fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'text/html' }, credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) {
            const payload = await readPayload(response);
            throw new Error(payload.error?.message ?? 'Could not save the change');
          }
          await refreshEditor(response.url, button, response);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Could not save the change';
          const statusNode = feedbackStatus(form, button);
          announce(message);
          if (statusNode) showStatus(statusNode, message, 'failed');
          else if (!form.querySelector('.inline-error')) form.insertAdjacentHTML('beforeend', '<p class="inline-error" role="alert">Could not save the change. Please try again.</p>');
        })
        .finally(() => { form.removeAttribute('aria-busy'); if (button) { button.disabled = false; button.textContent = label ?? 'Save'; } });
    });
  }
};

const initializeStudio = (root) => {
  const studio = root.querySelector('form[data-theme-studio]');
  if (!studio || studio.dataset.studioBound) return;
  studio.dataset.studioBound = 'true';
  const statusNode = studio.querySelector('[data-feedback-slot="fine-tune"] [data-operation-status]');
  const publishButton = root.querySelector('[data-publish-button]');
  const unsavedNote = studio.querySelector('[data-unsaved-note]');
  const publishInitiallyDisabled = publishButton?.disabled ?? true;
  const controlState = () => JSON.stringify([...studio.querySelectorAll('[data-theme-control]')]
    .filter((control) => !(control instanceof HTMLInputElement) || control.type !== 'radio' || control.checked)
    .map((control) => [control.name, control.value]));
  const initialControlState = controlState();
  let previewTimer;
  let previewRequest;

  const updateDirtyState = () => {
    const dirty = controlState() !== initialControlState;
    if (publishButton) publishButton.disabled = publishInitiallyDisabled || dirty;
    if (unsavedNote) unsavedNote.hidden = !dirty;
  };
  const updatePreview = async () => {
    previewRequest?.abort();
    previewRequest = new AbortController();
    showStatus(statusNode, 'Updating preview…', 'running');
    try {
      const response = await fetch('/api/theme/preview', { method: 'POST', body: new FormData(studio), headers: { accept: 'application/json' }, credentials: 'same-origin', signal: previewRequest.signal });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error?.message ?? 'Could not update the preview');
      showStatus(statusNode, payload.message ?? 'Preview updated; changes are not saved', 'succeeded');
      const preview = currentPreview();
      const origin = currentPreviewOrigin();
      if (preview && origin) preview.contentWindow?.postMessage({ type: 'vibelog-preview-refresh' }, new URL(origin).origin);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showStatus(statusNode, error instanceof Error ? error.message : 'Could not update the preview', 'failed');
    }
  };
  for (const control of studio.querySelectorAll('[data-theme-control]')) control.addEventListener('change', () => {
    updateDirtyState();
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => { void updatePreview(); }, 250);
  });
  for (const starter of studio.querySelectorAll('[data-prompt-starter]')) starter.addEventListener('click', () => {
    const prompt = studio.querySelector('#prompt');
    if (prompt instanceof HTMLTextAreaElement) { prompt.value = starter.dataset.promptStarter ?? ''; prompt.focus(); }
  });
  const prompt = studio.querySelector('#prompt');
  const generateButton = studio.querySelector('[data-operation-submit][data-feedback-target="ai"]');
  if (prompt instanceof HTMLTextAreaElement && generateButton instanceof HTMLButtonElement) prompt.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing || generateButton.disabled) return;
    event.preventDefault();
    studio.requestSubmit(generateButton);
  });
};

function initializeEditor(root = document) {
  initializeValidation(root);
  initializeHandles(root);
  initializeOperations(root);
  initializeEditorSubmits(root);
  initializeStudio(root);
  const pathInput = root.querySelector('[data-preview-path-input]');
  if (pathInput instanceof HTMLInputElement) rememberPreviewPath(pathInput.value);
  for (const statusNode of root.querySelectorAll('[data-poll-url]')) {
    if (statusNode.dataset.pollBound || !statusNode.dataset.pollUrl) continue;
    statusNode.dataset.pollBound = 'true';
    void poll(statusNode.dataset.pollUrl, statusNode, statusNode.dataset.successUrl ?? '/editor')
      .then((status) => { if (status === 'failed') unlockForm(statusNode); })
      .catch((error) => { showStatus(statusNode, error instanceof Error ? error.message : 'Could not read progress', 'failed'); unlockForm(statusNode); });
  }
}

initializeEditor(document);
`;
