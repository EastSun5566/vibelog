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

const unlockForm = (statusNode) => {
  const form = statusNode?.closest('form');
  form?.removeAttribute('aria-busy');
  const button = form?.querySelector('button[type="submit"]');
  if (button) button.disabled = false;
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
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const statusNode = form.querySelector('[data-operation-status]');
    const buttonLabel = button?.textContent;
    form.setAttribute('aria-busy', 'true');
    if (button) { button.disabled = true; button.textContent = '處理中…'; }
    showStatus(statusNode, '已送出，正在處理…');
    void fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await readPayload(response);
        if (!response.ok || !payload.pollUrl) throw new Error(payload.error?.message ?? '無法開始操作');
        await poll(payload.pollUrl, statusNode, form.dataset.successUrl ?? '/editor');
      })
      .catch((error) => showStatus(statusNode, error instanceof Error ? error.message : '操作失敗，請再試一次', true))
      .finally(() => {
        form.removeAttribute('aria-busy');
        if (button) { button.disabled = false; button.textContent = buttonLabel ?? '送出'; }
      });
  });
}

for (const statusNode of document.querySelectorAll('[data-poll-url]')) {
  if (statusNode.dataset.pollUrl) void poll(statusNode.dataset.pollUrl, statusNode, statusNode.dataset.successUrl ?? '/editor')
    .then((status) => { if (status === 'failed') unlockForm(statusNode); })
    .catch((error) => { showStatus(statusNode, error instanceof Error ? error.message : '無法讀取進度', true); unlockForm(statusNode); });
}
`;
