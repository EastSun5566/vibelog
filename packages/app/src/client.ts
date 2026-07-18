export const CLIENT_SCRIPT = String.raw`
const statusNode = document.querySelector('#operation-status');
const showError = (error) => {
  if (statusNode) statusNode.textContent = error instanceof Error ? error.message : '操作失敗，請再試一次';
};
const poll = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? '無法讀取進度');
  if (statusNode) statusNode.textContent = payload.message ?? '處理中，請稍候…';
  if (payload.status === 'succeeded') {
    window.setTimeout(() => { window.location.assign('/editor'); }, 500);
    return;
  }
  if (payload.status !== 'failed') window.setTimeout(() => { void poll(url).catch(showError); }, 800);
};
for (const form of document.querySelectorAll('form[data-operation]')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (statusNode) statusNode.textContent = '已送出，正在處理…';
    void fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.pollUrl) throw new Error(payload.error?.message ?? '無法開始操作');
        return poll(payload.pollUrl);
      })
      .catch(showError)
      .finally(() => { if (button) button.disabled = false; });
  });
}
const inlinePoll = document.querySelector('[data-poll-url]');
if (inlinePoll?.dataset.pollUrl) void poll(inlinePoll.dataset.pollUrl).catch(showError);
`;
