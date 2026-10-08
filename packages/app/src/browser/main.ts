import { createEditorDom, type ClientRoot } from './dom.js';
import { initializeHandles, initializeValidation } from './forms.js';
import { initializeEditorSubmits, initializeOperations, initializePendingOperations } from './operations.js';
import { initializeStudio } from './theme-studio.js';

const dom = createEditorDom((root) => {
  initializeEditor(root);
});

function initializeEditor(root: ClientRoot = document): void {
  initializeValidation(root);
  initializeHandles(root);
  initializeOperations(root, dom);
  initializeEditorSubmits(root, dom);
  initializeStudio(root, dom);
  const pathInput = root.querySelector<HTMLInputElement>('[data-preview-path-input]');
  if (pathInput) dom.rememberPreviewPath(pathInput.value);
  initializePendingOperations(root, dom);
}

dom.bindGlobalListeners();
initializeEditor();

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const entry = event.target.closest('[data-copy-agent-prompt]')?.closest('[data-agent-prompt]');
  if (!entry) return;
  void (async () => {
    const prompt = entry.querySelector<HTMLTextAreaElement>('#agent-prompt');
    const status = entry.querySelector<HTMLOutputElement>('[data-agent-copy-status]');
    if (!prompt || !status) return;
    try { await navigator.clipboard.writeText(prompt.value); status.textContent = 'Copied. Paste it into your coding agent.'; }
    catch {
      const disclosure = prompt.closest('details');
      if (disclosure) disclosure.open = true;
      prompt.focus(); prompt.select(); status.textContent = 'Select and copy the prompt.';
    }
  })();
});
