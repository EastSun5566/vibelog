/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { defineToolbarApp } from 'astro/toolbar';

export default defineToolbarApp({
  init(canvas, app) {
    canvas.innerHTML = `
      <div class="vibe-container">
        <form class="vibe-form">
          <input 
            type="text" 
            class="vibe-prompt" 
            placeholder="Enter your style prompt..."
          />
          <button type="submit" class="vibe-button">Vibe</button>
        </form>
      </div>

      <style>
      .vibe-container {
        display: flex;
        justify-content: center;
      }
      </style>
    `;

    const form = canvas.querySelector<HTMLFormElement>('.vibe-form')!;
    const input = canvas.querySelector<HTMLInputElement>('.vibe-prompt')!;
    const button = canvas.querySelector<HTMLButtonElement>('.vibe-button')!;

    async function handleTransform() {
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

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleTransform().catch(console.error);
    });

    app.onToggled(({ state }) => {
      if (state) {
        input.focus();
      }
    });
  },
});
