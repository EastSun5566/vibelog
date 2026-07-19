export const CLIENT_SCRIPT = String.raw`
const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const readPayload = async (response) => {
  try { return await response.json(); }
  catch { return {}; }
};

const showStatus = (node, message, failed = false) => {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', failed);
  if (failed) node.focus();
};

const syncAriaInvalid = (control) => {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
  if (!control.checkValidity()) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
};

for (const form of document.forms) {
  form.addEventListener('invalid', (event) => syncAriaInvalid(event.target), true);
  form.addEventListener('blur', (event) => syncAriaInvalid(event.target), true);
  form.addEventListener('input', (event) => syncAriaInvalid(event.target));
  form.addEventListener('submit', () => {
    for (const control of form.elements) syncAriaInvalid(control);
  });
}

const unlockForm = (statusNode) => {
  const form = statusNode?.closest('form');
  form?.removeAttribute('aria-busy');
  for (const button of form?.querySelectorAll('button[type="submit"]') ?? []) button.disabled = false;
};

const poll = async (url, statusNode, successUrl = '/editor') => {
  while (true) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error?.message ?? '無法讀取進度');
    showStatus(statusNode, payload.message ?? '處理中，請稍候…', payload.status === 'failed');
    if (payload.status === 'succeeded') {
      await sleep(500);
      window.location.assign(successUrl);
      return 'succeeded';
    }
    if (payload.status === 'failed') return 'failed';
    await sleep(1000);
  }
};

for (const form of document.querySelectorAll('form[data-operation]')) {
  form.addEventListener('submit', (event) => {
    const submitter = event.submitter;
    if (form.hasAttribute('data-mixed-actions') && !submitter?.hasAttribute('data-operation-submit')) return;
    event.preventDefault();
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    const button = submitter instanceof HTMLButtonElement ? submitter : buttons[0];
    const statusNode = form.querySelector('[data-operation-status]');
    const buttonLabel = button?.textContent;
    form.setAttribute('aria-busy', 'true');
    for (const item of buttons) item.disabled = true;
    if (button) button.textContent = '處理中…';
    showStatus(statusNode, '已送出，正在處理…');
    const action = button?.hasAttribute('formaction') ? button.formAction : form.action;
    void fetch(action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await readPayload(response);
        if (!response.ok || !payload.pollUrl) throw new Error(payload.error?.message ?? '無法開始操作');
        await poll(payload.pollUrl, statusNode, form.dataset.successUrl ?? '/editor');
      })
      .catch((error) => showStatus(statusNode, error instanceof Error ? error.message : '操作失敗，請再試一次', true))
      .finally(() => {
        form.removeAttribute('aria-busy');
        for (const item of buttons) item.disabled = false;
        if (button) button.textContent = buttonLabel ?? '送出';
      });
  });
}

const studio = document.querySelector('form[data-theme-studio]');
if (studio) {
  const statusNode = studio.querySelector('[data-operation-status]');
  const preview = document.querySelector('iframe[data-preview-url]');
  const publishButton = document.querySelector('[data-publish-button]');
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
    showStatus(statusNode, '正在更新預覽…');
    try {
      const response = await fetch('/api/theme/preview', {
        method: 'POST', body: new FormData(studio), headers: { accept: 'application/json' },
        credentials: 'same-origin', signal: previewRequest.signal,
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error?.message ?? '無法更新預覽');
      showStatus(statusNode, payload.message ?? '預覽已更新，尚未儲存');
      if (preview?.dataset.previewUrl) {
        const url = new URL(preview.dataset.previewUrl);
        url.searchParams.set('theme', String(Date.now()));
        preview.src = url.toString();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showStatus(statusNode, error instanceof Error ? error.message : '無法更新預覽', true);
    }
  };

  for (const control of studio.querySelectorAll('[data-theme-control]')) {
    control.addEventListener('change', () => {
      updateDirtyState();
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => { void updatePreview(); }, 250);
    });
  }

  for (const starter of studio.querySelectorAll('[data-prompt-starter]')) {
    starter.addEventListener('click', () => {
      const prompt = studio.querySelector('#prompt');
      if (prompt instanceof HTMLTextAreaElement) {
        prompt.value = starter.dataset.promptStarter ?? '';
        prompt.focus();
      }
    });
  }
}

for (const statusNode of document.querySelectorAll('[data-poll-url]')) {
  if (statusNode.dataset.pollUrl) void poll(statusNode.dataset.pollUrl, statusNode, statusNode.dataset.successUrl ?? '/editor')
    .then((status) => { if (status === 'failed') unlockForm(statusNode); })
    .catch((error) => { showStatus(statusNode, error instanceof Error ? error.message : '無法讀取進度', true); unlockForm(statusNode); });
}
`;
