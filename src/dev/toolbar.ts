export function createPanelScript() {

  const createVibelogUi = () => {
    const html = (strings: TemplateStringsArray, ...values: string[]) => {
      return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
    };
    const css = (strings: TemplateStringsArray, ...values: string[]) => {
      return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
    };

    return class VibelogUi extends HTMLElement {
      cleanup: (() => void) | null = null;

      constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });

        const panelHtml = html`
  <section class="vibelog-panel" id="vibelog-panel">
    <form class="vibelog-form">
      <textarea
        class="vibelog-prompt" 
        placeholder="Describe the vibe you want to create... ✨"
        rows="3"
        required
        autofocus
        title="Enter your vibe prompt"
      >Light theme with a calm green tone</textarea>

      <button type="submit" class="vibelog-button" title="Create vibe">✨</button>
    </form>

    <span class="vibelog-dragger" id="vibelog-dragger" title="Drag to move">
      ⋮⋮
    </span>
  </section>
  `;

        const panelCss = css`
  .vibelog-panel {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    gap: 2px;
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 999;
    min-width: 300px;
    background: var(--vibe-c-black);
    color: var(--vibe-c-white);
    border-radius: var(--vibe-border-radius-md);
    padding: var(--vibe-space-1);
    box-shadow: var(--vibe-shadow-3);

    &.dragging {
      transition: none;
    }
  }

  .vibelog-form {
    display: flex;
    gap: var(--vibe-space-1);
  }

  .vibelog-prompt {
    font-size: 14px;
    line-height: 1.5;
    background: var(--vibe-c-bg);
    color: var(--vibe-c-text-1);
    padding: var(--vibe-space-1);
    border: var(--vibe-border-width-thin) solid var(--vibe-c-gray-2);
    border-radius:  var(--vibe-border-radius-md);
    resize: none;

    &:focus {
      outline: none;
      border-color: var(--vibe-accent);
      box-shadow: var(--vibe-shadow-1);
    }
  }

  .vibelog-button {
    font-size: 14px;
    padding: var(--vibe-space-1) var(--vibe-space-2);
    border: none;
    border-radius: var(--vibe-border-radius-md);
    background: var(--vibe-accent);
    color: var(--vibe-c-white);
    min-width: 60px;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;  
    }
  }

  .vibelog-dragger {
    cursor: move;
    user-select: none;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  `;

        shadow.innerHTML = `
        ${panelHtml}
  
        <style>
          ${panelCss}
        </style>
        `;
        const panel = shadow.querySelector<HTMLDivElement>('#vibelog-panel');
        const dragger = shadow.querySelector<HTMLDivElement>('#vibelog-dragger');
        const form = shadow.querySelector<HTMLFormElement>('.vibelog-form');
        const textarea = shadow.querySelector<HTMLTextAreaElement>('.vibelog-prompt');
        const button = shadow.querySelector<HTMLButtonElement>('.vibelog-button');

        const STORAGE_KEY = 'vibelog-panel-position';
        const CONTENT_KEY = 'vibelog-panel-content';
        const savePosition = (x: number, y: number) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
        };
        const loadPosition = () =>  {
          const saved = localStorage.getItem(STORAGE_KEY);
          return saved ? JSON.parse(saved) as { x: number; y: number } : null;
        };
        const restorePosition = () => {
          if (!panel) return;

          const savedPosition = loadPosition();
          if (savedPosition) {
            const rect = panel.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;

            const x = Math.max(0, Math.min(savedPosition.x, maxX));
            const y = Math.max(0, Math.min(savedPosition.y, maxY));

            panel.style.left = `${x.toString()}px`;
            panel.style.top = `${y.toString()}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
          }
        };

        const saveContent = (content: string) => {
          localStorage.setItem(CONTENT_KEY, content);
        };
        const loadContent = () => {
          return localStorage.getItem(CONTENT_KEY) ?? '';
        };
        const restoreContent = () => {
          if (!textarea) return;

          const savedContent = loadContent();
          if (savedContent) {
            textarea.value = savedContent;
            return;
          }

          textarea.value = 'Light theme with a calm green tone';
        };

        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let panelStartX = 0;
        let panelStartY = 0;

        function dragStart(event: MouseEvent) {
          if (!panel || !dragger) return;

          if (event.target === dragger || dragger.contains(event.target as Node)) {
            isDragging = true;
            panel.classList.add('dragging');

            dragStartX = event.clientX;
            dragStartY = event.clientY;

            const rect = panel.getBoundingClientRect();
            panelStartX = rect.left;
            panelStartY = rect.top;
          }
        }

        function dragEnd() {
          if (!panel) return;

          isDragging = false;
          panel.classList.remove('dragging');

          const rect = panel.getBoundingClientRect();
          savePosition(rect.left, rect.top);
        }

        function drag(event: MouseEvent) {
          event.preventDefault();
          if (!isDragging || !panel) return;

          event.preventDefault();
          const deltaX = event.clientX - dragStartX;
          const deltaY = event.clientY - dragStartY;

          let newX = panelStartX + deltaX;
          let newY = panelStartY + deltaY;

          const rect = panel.getBoundingClientRect();
          const maxX = window.innerWidth - rect.width;
          const maxY = window.innerHeight - rect.height;

          newX = Math.max(0, Math.min(newX, maxX));
          newY = Math.max(0, Math.min(newY, maxY));

          panel.style.left = `${newX.toString()}px`;
          panel.style.top = `${newY.toString()}px`;
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
        }

        dragger?.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);


        async function handleTransform() {
          if (!form || !textarea || !button) return;

          const prompt = textarea.value.trim();
          if (!prompt) return;

          try {
            button.textContent = '🚀...';
            button.disabled = true;

            const response = await fetch('/_vibe/transform', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt }),
            });
            if (!response.ok) {
              const errorMessage = await response.json().then(({ error }: { error?: string }) => error);
              throw new Error(errorMessage ?? 'Failed to transform styles');
            }

            textarea.value = '';
            saveContent('');
          } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : 'An error occurred');
          } finally {
            button.textContent = '✨';
            button.disabled = false;
          }
        }

        function handleKeyDown(event: KeyboardEvent) {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            handleTransform().catch(console.error);
          }
        }
        textarea?.addEventListener('keydown', handleKeyDown);
        textarea?.addEventListener('input', () => {
          saveContent(textarea.value);
        });

        form?.addEventListener('submit', (event) => {
          event.preventDefault();
          handleTransform().catch(console.error);
        });

        this.cleanup = () => {
          document.removeEventListener('mousemove', drag);
          document.removeEventListener('mouseup', dragEnd);
        };

        setTimeout(() => {
          restorePosition();
          restoreContent();
        }, 0);
      }

      disconnectedCallback() {
        this.cleanup?.();
      }
    };
  };

  return `
    // esbuild will inject this function, but I don't know why :(
    function __name(target, name) {
      return target;
    }

    customElements.define('vibelog-ui', (${createVibelogUi.toString()})());
    document.body.appendChild(document.createElement('vibelog-ui'));
  `;
}
