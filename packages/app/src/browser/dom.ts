import type { ApiPayload } from './api.js';

export type ClientRoot = Document | Element;
export type InitializeEditor = (root: ClientRoot) => void;

interface EditorState {
  scrollX: number;
  scrollY: number;
  disclosures: string[];
  focusKey?: string;
  sectionId?: string;
}

export interface EditorDom {
  announce(message: string): void;
  bindGlobalListeners(): void;
  currentPreview(): HTMLIFrameElement | null;
  currentPreviewOrigin(): string | undefined;
  feedbackStatus(root: ClientRoot, trigger?: HTMLElement | null): HTMLElement | null;
  getPreviewPath(): string;
  refreshEditor(successUrl?: string, trigger?: HTMLElement | null, existingResponse?: Response): Promise<void>;
  rememberPreviewPath(value: unknown): void;
  showStatus(node: HTMLElement | null, message: string, state?: string): void;
  updateProgress(statusNode: HTMLElement | null, progress?: ApiPayload['progress']): void;
}

function previewLocationMessage(value: unknown): value is { type: 'vibelog-preview-location'; path: unknown } {
  return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'vibelog-preview-location' && 'path' in value);
}

export function createEditorDom(initializeEditor: InitializeEditor): EditorDom {
  let currentPreviewPath = '/';

  const currentPreview = () => document.querySelector<HTMLIFrameElement>('iframe[data-preview-url]');
  const currentPreviewOrigin = () => currentPreview()?.dataset.previewOrigin;
  const safePreviewPath = (value: unknown) => {
    const origin = currentPreviewOrigin();
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || !origin) return '/';
    try {
      const url = new URL(value, origin);
      return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : '/';
    } catch {
      return '/';
    }
  };
  const rememberPreviewPath = (value: unknown) => {
    currentPreviewPath = safePreviewPath(value);
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-preview-path-input]')) input.value = currentPreviewPath;
  };
  const showStatus = (node: HTMLElement | null, message: string, state = 'running') => {
    if (!node) return;
    node.textContent = message;
    const feedback = node.closest<HTMLElement>('[data-operation-feedback]');
    if (feedback) feedback.dataset.state = message ? state : 'idle';
    if (state === 'failed') node.dataset.variant = 'destructive';
    else delete node.dataset.variant;
    if (state === 'failed') node.focus();
  };
  const feedbackStatus = (root: ClientRoot, trigger?: HTMLElement | null) => {
    const key = trigger?.dataset.feedbackTarget;
    const feedback = key
      ? root.querySelector<HTMLElement>(`[data-feedback-slot="${CSS.escape(key)}"]`)
      : root.querySelector<HTMLElement>('[data-operation-feedback]');
    return feedback?.querySelector<HTMLElement>('[data-operation-status]') ?? null;
  };
  const updateProgress = (statusNode: HTMLElement | null, progress: ApiPayload['progress'] = { kind: 'indeterminate' }) => {
    const node = statusNode?.closest('[data-operation-feedback]')?.querySelector('[data-operation-progress]');
    if (!(node instanceof HTMLProgressElement)) return;
    const determinate = progress?.kind === 'determinate' && Number.isFinite(progress.value) && Number.isFinite(progress.max) && (progress.max ?? 0) > 0;
    node.hidden = !determinate;
    if (determinate) {
      node.max = progress?.max ?? 1;
      node.value = Math.min(node.max, Math.max(0, progress?.value ?? 0));
    } else {
      node.removeAttribute('value');
    }
  };
  const announce = (message: string) => {
    const node = document.querySelector<HTMLElement>('[data-page-status]');
    if (node) node.textContent = message;
  };
  const editorTargetUrl = (value = '/editor') => {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || url.pathname !== '/editor') return new URL('/editor', location.origin);
    if (currentPreviewPath !== '/') url.searchParams.set('previewPath', currentPreviewPath);
    else url.searchParams.delete('previewPath');
    return url;
  };
  const captureEditorState = (trigger?: HTMLElement | null): EditorState => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    disclosures: [...document.querySelectorAll<HTMLElement>('details[data-disclosure-key][open]')]
      .map((item) => item.dataset.disclosureKey)
      .filter((key): key is string => Boolean(key)),
    focusKey: trigger?.dataset.focusKey,
    sectionId: trigger?.closest<HTMLElement>('.workflow-section')?.id,
  });
  const replaceEditor = (html: string, state: EditorState) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const incoming = parsed.querySelector<HTMLElement>('[data-editor-root]');
    const current = document.querySelector<HTMLElement>('[data-editor-root]');
    if (!incoming || !current) throw new Error('Could not refresh the editor');
    current.replaceWith(incoming);
    for (const key of state.disclosures) incoming.querySelector<HTMLElement>(`details[data-disclosure-key="${CSS.escape(key)}"]`)?.setAttribute('open', '');
    initializeEditor(incoming);
    requestAnimationFrame(() => {
      window.scrollTo(state.scrollX, state.scrollY);
      const preferred = state.focusKey ? incoming.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(state.focusKey)}"]`) : null;
      const heading = state.sectionId ? incoming.querySelector<HTMLElement>(`#${CSS.escape(state.sectionId)} h2`) : null;
      const target = preferred && !preferred.matches(':disabled') ? preferred : heading;
      if (target) {
        if (!target.hasAttribute('tabindex') && target === heading) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
    announce('Editor updated.');
  };
  const refreshEditor = async (successUrl = '/editor', trigger?: HTMLElement | null, existingResponse?: Response) => {
    const state = captureEditorState(trigger);
    try {
      const response = existingResponse ?? await fetch(editorTargetUrl(successUrl), { headers: { accept: 'text/html' }, credentials: 'same-origin' });
      if (!response.ok || new URL(response.url).pathname !== '/editor') throw new Error('Could not refresh the editor');
      replaceEditor(await response.text(), state);
    } catch {
      window.location.assign(editorTargetUrl(successUrl));
    }
  };
  const bindGlobalListeners = () => {
    window.addEventListener('message', (event) => {
      const preview = currentPreview();
      const origin = currentPreviewOrigin();
      if (!preview || !origin || event.origin !== new URL(origin).origin || event.source !== preview.contentWindow || !previewLocationMessage(event.data)) return;
      rememberPreviewPath(event.data.path);
    });
    const editorUrl = new URL(location.href);
    if (editorUrl.pathname === '/editor' && editorUrl.searchParams.has('previewPath')) {
      editorUrl.searchParams.delete('previewPath');
      history.replaceState(history.state, '', editorUrl.pathname + editorUrl.search + editorUrl.hash);
    }
  };

  return {
    announce,
    bindGlobalListeners,
    currentPreview,
    currentPreviewOrigin,
    feedbackStatus,
    getPreviewPath: () => currentPreviewPath,
    refreshEditor,
    rememberPreviewPath,
    showStatus,
    updateProgress,
  };
}
