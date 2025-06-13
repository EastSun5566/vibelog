export function createPanelScript() {

  const createVibelogUi = () => {
    const html = (strings: TemplateStringsArray, ...values: string[]) => {
      return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
    };
    const css = (strings: TemplateStringsArray, ...values: string[]) => {
      return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
    };

    return class VibelogUi extends HTMLElement {
      constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });

        const panelHtml = html`
  <div class="vibelog-panel">
      <form class="vibelog-form">
        <textarea
          class="vibelog-prompt" 
          placeholder="✨🔥🚀"
          rows="3"
          required
          autofocus
          style="resize: none"
        >Light theme with a calm green tone</textarea>

        <button type="submit" class="vibelog-button">Vibe</button>
      </form>
  </div>
  `;

        const panelCss = css`
  .vibelog-panel {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 999;
    background: var(--vibe-c-black);
    border-radius: var(--vibe-border-radius-md);
    padding: var(--vibe-space-1);
    box-shadow: var(--vibe-shadow-1);
  }

  .vibelog-form {
    display: flex;
    gap: var(--vibe-space-1);
  }

  .vibelog-prompt {
    padding: var(--vibe-space-1);
    border: var(--vibe-border-width-thin) solid var(--vibe-c-gray-2);
    border-radius:  var(--vibe-border-radius-md);
  }

  .vibelog-button {
    padding: var(--vibe-space-1) var(--vibe-space-2);
    border: none;
    border-radius: var(--vibe-border-radius-md);
    background: var(--vibe-accent);
    color: var(--vibe-c-white);
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;  
    }
  }
  `;

        shadow.innerHTML = `
        ${panelHtml}
  
        <style>
          ${panelCss}
        </style>
        `;

        const form = shadow.querySelector<HTMLFormElement>('.vibelog-form');
        const textarea = shadow.querySelector<HTMLTextAreaElement>('.vibelog-prompt');
        const button = shadow.querySelector<HTMLButtonElement>('.vibelog-button');

        async function handleTransform() {
          if (!form || !textarea || !button) return;

          const prompt = textarea.value.trim();
          if (!prompt) return;

          try {
            button.textContent = 'Vibing...';
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
          } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : 'An error occurred');
          } finally {
            button.textContent = 'Vibe';
            button.disabled = false;
          }
        }

        form?.addEventListener('submit', (event) => {
          event.preventDefault();
          handleTransform().catch(console.error);
        });
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
