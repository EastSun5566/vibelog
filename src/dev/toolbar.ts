export class VibeUI extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <div class="vibe-container">
        <form class="vibe-form">
          <input 
            type="text" 
            class="vibe-prompt" 
            placeholder="style prompt..."
          />
          <button type="submit" class="vibe-button">Vibe</button>
        </form>
      </div>

      <style>
        .vibe-container {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 999999;
          background: var(--vibe-black);
          border-radius: 4px;
          padding: 8px;
          box-shadow: var(--vibe-box-shadow);
        }

        .vibe-form {
          display: flex;
          gap: 8px;
        }

        .vibe-prompt {
          padding: 8px;
          border: 1px solid var(--vibe-gray-2);
          border-radius: 4px;
          background: transparent;
        }

        .vibe-button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          background: var(--vibe-accent);
          color: var(--vibe-white);
          cursor: pointer;
        }

        .vibe-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      </style>
    `;

    const form = shadow.querySelector<HTMLFormElement>('.vibe-form');
    const input = shadow.querySelector<HTMLInputElement>('.vibe-prompt');
    const button = shadow.querySelector<HTMLButtonElement>('.vibe-button');

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
          throw new Error('Transform failed');
        }

        button.textContent = 'Vibe';
        input.value = '';
      } catch (error) {
        console.error(error);
        button.textContent = 'Error';
      } finally {
        button.disabled = false;
      }
    }

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      handleTransform().catch(console.error);
    });
  }
}
