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
