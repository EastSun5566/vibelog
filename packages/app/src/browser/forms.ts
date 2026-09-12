import type { ClientRoot } from './dom.js';

function syncAriaInvalid(control: EventTarget | null): void {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
  if (!control.validity.valid) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
}

export function initializeValidation(root: ClientRoot): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form')) {
    if (form.dataset.validationBound) continue;
    form.dataset.validationBound = 'true';
    form.addEventListener('invalid', (event) => {
      syncAriaInvalid(event.target);
    }, true);
    form.addEventListener('blur', (event) => {
      syncAriaInvalid(event.target);
    }, true);
    form.addEventListener('input', (event) => {
      syncAriaInvalid(event.target);
    });
    form.addEventListener('submit', () => {
      for (const control of form.elements) syncAriaInvalid(control);
    });
  }
}

export function initializeHandles(root: ClientRoot): void {
  const blogHandle = root.querySelector<HTMLInputElement>('[data-blog-handle]');
  const blogHostname = root.querySelector<HTMLElement>('[data-blog-hostname]');
  if (blogHandle && blogHostname && !blogHandle.dataset.handleBound) {
    blogHandle.dataset.handleBound = 'true';
    const update = () => {
      blogHostname.textContent = `${blogHandle.value.trim().toLowerCase() || 'your-name'}.${blogHostname.dataset.hostSuffix ?? ''}`;
    };
    blogHandle.addEventListener('input', update);
    update();
  }

  const hackmdHandle = root.querySelector<HTMLInputElement>('#hackmdUsername');
  const hackmdProfile = root.querySelector<HTMLAnchorElement>('[data-hackmd-profile]');
  if (hackmdHandle && hackmdProfile && !hackmdHandle.dataset.profileBound) {
    hackmdHandle.dataset.profileBound = 'true';
    const update = () => {
      const username = hackmdHandle.value.trim();
      hackmdProfile.textContent = `https://hackmd.io/@${username || 'username'}`;
      if (username) {
        hackmdProfile.href = `https://hackmd.io/@${encodeURIComponent(username)}`;
        hackmdProfile.removeAttribute('aria-disabled');
      } else {
        hackmdProfile.removeAttribute('href');
        hackmdProfile.setAttribute('aria-disabled', 'true');
      }
    };
    hackmdHandle.addEventListener('input', update);
    update();
  }
}
