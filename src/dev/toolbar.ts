function html(strings: TemplateStringsArray, ...values: string[]) {
  return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
}

function css(strings: TemplateStringsArray, ...values: string[]) {
  return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
}

const toolbarHtml = html`
<div class="vibe-container">
    <form class="vibe-form">
      <input 
        type="text" 
        class="vibe-prompt" 
        placeholder="style prompt..."
        required
      />

      <button type="submit" class="vibe-button">Vibe</button>
    </form>
</div>
`;

const toolbarCss = css`
.vibe-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 999;
  background: var(--vibe-c-black);
  border-radius: 4px;
  padding: 8px;
  box-shadow: var(--vibe-shadow-1);
}

.vibe-form {
  display: flex;
  gap: 8px;
}

.vibe-prompt {
  padding: 8px;
  border: 1px solid var(--vibe-c-gray-2);
  border-radius: 4px;
}

.vibe-button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background: var(--vibe-accent);
  color: var(--vibe-c-white);
  cursor: pointer;
}

.vibe-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;

export const TOOLBAR_CODE = `class VibeUI extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.innerHTML = \`
      ${toolbarHtml}

      <style>
        ${toolbarCss}
      </style>
    \`;

    const form = shadow.querySelector('.vibe-form');
    const input = shadow.querySelector('.vibe-prompt');
    const button = shadow.querySelector('.vibe-button');

    async function handleTransform() {
      if (!form || !input || !button) return;

      const prompt = input.value.trim();
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
          throw new Error(await response.json().then(({ error }) => error));
        }

        input.value = '';
      } catch (error) {
        console.error(error);
        alert(error.message);
      } finally {
        button.textContent = 'Vibe';
        button.disabled = false;
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleTransform().catch(console.error);
    });
  }
}
`;
