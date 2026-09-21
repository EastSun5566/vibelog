import { readPayload } from './api.js';
import type { ClientRoot, EditorDom } from './dom.js';

type ThemeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function initializeStudio(root: ClientRoot, dom: EditorDom): void {
  const studio = root.querySelector<HTMLFormElement>('form[data-theme-studio]');
  if (!studio || studio.dataset.studioBound) return;
  studio.dataset.studioBound = 'true';
  const statusNode = studio.querySelector<HTMLElement>('[data-feedback-slot="fine-tune"] [data-operation-status]');
  const publishButton = root.querySelector<HTMLButtonElement>('[data-publish-button]');
  const unsavedNote = studio.querySelector<HTMLElement>('[data-unsaved-note]');
  const publishInitiallyDisabled = publishButton?.disabled ?? true;
  const controlState = () => JSON.stringify([...studio.querySelectorAll<ThemeControl>('[data-theme-control]')]
    .filter((control) => !(control instanceof HTMLInputElement) || control.type !== 'radio' || control.checked)
    .map((control) => [control.name, control.value]));
  const initialControlState = controlState();
  const structuralControlState = () => JSON.stringify([...studio.querySelectorAll<ThemeControl>('[data-theme-control][data-preview-kind="structural"]')]
    .filter((control) => !(control instanceof HTMLInputElement) || control.type !== 'radio' || control.checked)
    .map((control) => [control.name, control.value]));
  const initialStructuralControlState = structuralControlState();
  const hasStructuralChanges = () => structuralControlState() !== initialStructuralControlState;
  let previewTimer: number | undefined;
  let previewRequest: AbortController | undefined;

  const updateDirtyState = () => {
    const dirty = controlState() !== initialControlState;
    if (publishButton) publishButton.disabled = publishInitiallyDisabled || dirty;
    if (unsavedNote) unsavedNote.hidden = !dirty;
  };
  const updatePreview = async () => {
    previewRequest?.abort();
    previewRequest = new AbortController();
    dom.showStatus(statusNode, 'Updating preview…', 'running');
    try {
      const response = await fetch('/api/design/preview', { method: 'POST', body: new FormData(studio), headers: { accept: 'application/json' }, credentials: 'same-origin', signal: previewRequest.signal });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error?.message ?? 'Could not update the preview');
      dom.showStatus(statusNode, hasStructuralChanges()
        ? 'Visual preview updated. Build this design version to apply layout changes.'
        : payload.message ?? 'Visual preview updated; changes are not saved', 'succeeded');
      const preview = dom.currentPreview();
      const origin = dom.currentPreviewOrigin();
      if (preview && origin) preview.contentWindow?.postMessage({ type: 'vibelog-preview-refresh' }, new URL(origin).origin);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      dom.showStatus(statusNode, error instanceof Error ? error.message : 'Could not update the preview', 'failed');
    }
  };

  for (const control of studio.querySelectorAll<ThemeControl>('[data-theme-control]')) {
    control.addEventListener('change', () => {
      updateDirtyState();
      window.clearTimeout(previewTimer);
      if (control.dataset.previewKind === 'structural') {
        previewRequest?.abort();
        dom.showStatus(statusNode, 'Layout changes will appear after you build this design version.', 'succeeded');
        return;
      }
      previewTimer = window.setTimeout(() => void updatePreview(), 250);
    });
  }
  for (const starter of studio.querySelectorAll<HTMLElement>('[data-prompt-starter]')) {
    starter.addEventListener('click', () => {
      const prompt = studio.querySelector<HTMLTextAreaElement>('#prompt');
      if (prompt) {
        prompt.value = starter.dataset.promptStarter ?? '';
        prompt.focus();
      }
    });
  }
  const prompt = studio.querySelector<HTMLTextAreaElement>('#prompt');
  const generateButton = studio.querySelector<HTMLButtonElement>('[data-operation-submit][data-feedback-target="ai"]');
  if (prompt && generateButton) {
    prompt.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing || generateButton.disabled) return;
      event.preventDefault();
      studio.requestSubmit(generateButton);
    });
  }
}
