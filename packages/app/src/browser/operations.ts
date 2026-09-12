import { readPayload } from './api.js';
import type { ClientRoot, EditorDom } from './dom.js';

const sleep = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function unlockForm(statusNode: HTMLElement | null): void {
  const form = statusNode?.closest<HTMLFormElement>('form');
  form?.removeAttribute('aria-busy');
  for (const button of form?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? []) button.disabled = false;
}

async function poll(dom: EditorDom, url: string, statusNode: HTMLElement | null, successUrl = '/editor', trigger?: HTMLElement | null): Promise<'succeeded' | 'failed'> {
  while (true) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error?.message ?? 'Could not read progress');
    dom.updateProgress(statusNode, payload.progress);
    dom.showStatus(statusNode, payload.message ?? 'Working…', payload.status);
    if (payload.status === 'succeeded') {
      await sleep(350);
      if (document.querySelector('[data-editor-root]')) await dom.refreshEditor(successUrl, trigger);
      else window.location.assign(successUrl);
      return 'succeeded';
    }
    if (payload.status === 'failed') return 'failed';
    await sleep(1000);
  }
}

export function initializeOperations(root: ClientRoot, dom: EditorDom): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form[data-operation]')) {
    if (form.dataset.operationBound) continue;
    form.dataset.operationBound = 'true';
    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (form.hasAttribute('data-mixed-actions') && (!(submitter instanceof HTMLElement) || !submitter.hasAttribute('data-operation-submit'))) return;
      event.preventDefault();
      const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
      const button = submitter instanceof HTMLButtonElement ? submitter : buttons[0];
      const statusNode = dom.feedbackStatus(form, button);
      const buttonLabel = button?.textContent;
      form.setAttribute('aria-busy', 'true');
      for (const item of buttons) item.disabled = true;
      if (button) button.textContent = 'Working…';
      dom.rememberPreviewPath(dom.getPreviewPath());
      dom.updateProgress(statusNode);
      dom.showStatus(statusNode, 'Submitted and waiting…', 'queued');
      const action = button?.hasAttribute('formaction') ? button.formAction : form.action;
      void fetch(action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then(async (response) => {
          const payload = await readPayload(response);
          if (!response.ok || !payload.pollUrl) {
            if (payload.error?.code === 'blog_address_taken') {
              const input = form.querySelector<HTMLElement>('[data-blog-handle]');
              const error = form.querySelector<HTMLElement>('[data-blog-address-error]');
              input?.setAttribute('aria-invalid', 'true');
              if (error) {
                error.textContent = payload.error.message ?? 'That blog address is already taken. Choose another one.';
                error.hidden = false;
              }
            }
            throw new Error(payload.error?.message ?? 'Could not start the operation');
          }
          await poll(dom, payload.pollUrl, statusNode, payload.successUrl ?? form.dataset.successUrl ?? '/editor', button);
        })
        .catch((error: unknown) => {
          dom.showStatus(statusNode, error instanceof Error ? error.message : 'The operation failed. Please try again.', 'failed');
        })
        .finally(() => {
          form.removeAttribute('aria-busy');
          for (const item of buttons) item.disabled = false;
          if (button) button.textContent = buttonLabel ?? 'Submit';
        });
    });
  }
}

export function initializeEditorSubmits(root: ClientRoot, dom: EditorDom): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form[data-editor-submit]')) {
    if (form.dataset.editorSubmitBound) continue;
    form.dataset.editorSubmitBound = 'true';
    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (submitter instanceof HTMLElement && submitter.hasAttribute('data-operation-submit')) return;
      event.preventDefault();
      const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const label = button?.textContent;
      form.setAttribute('aria-busy', 'true');
      if (button) {
        button.disabled = true;
        button.textContent = 'Saving…';
      }
      dom.rememberPreviewPath(dom.getPreviewPath());
      void fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'text/html' }, credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) {
            const payload = await readPayload(response);
            throw new Error(payload.error?.message ?? 'Could not save the change');
          }
          await dom.refreshEditor(response.url, button, response);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Could not save the change';
          const statusNode = dom.feedbackStatus(form, button);
          dom.announce(message);
          if (statusNode) {
            dom.showStatus(statusNode, message, 'failed');
          } else if (!form.querySelector('.inline-error')) {
            const errorNode = document.createElement('p');
            errorNode.className = 'inline-error';
            errorNode.setAttribute('role', 'alert');
            errorNode.textContent = 'Could not save the change. Please try again.';
            form.append(errorNode);
          }
        })
        .finally(() => {
          form.removeAttribute('aria-busy');
          if (button) {
            button.disabled = false;
            button.textContent = label ?? 'Save';
          }
        });
    });
  }
}

export function initializePendingOperations(root: ClientRoot, dom: EditorDom): void {
  for (const statusNode of root.querySelectorAll<HTMLElement>('[data-poll-url]')) {
    if (statusNode.dataset.pollBound || !statusNode.dataset.pollUrl) continue;
    statusNode.dataset.pollBound = 'true';
    void poll(dom, statusNode.dataset.pollUrl, statusNode, statusNode.dataset.successUrl ?? '/editor')
      .then((status) => {
        if (status === 'failed') unlockForm(statusNode);
      })
      .catch((error: unknown) => {
        dom.showStatus(statusNode, error instanceof Error ? error.message : 'Could not read progress', 'failed');
        unlockForm(statusNode);
      });
  }
}
