import { describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../src/ports/artifact-store.js';
import type { OperationMessage, OperationQueue } from '../src/ports/operation-queue.js';
import type { TransactionalEmailSender } from '../src/ports/transactional-email.js';

describe('provider-neutral I/O contracts', () => {
  it('addresses artifacts by immutable ID and relative object path', async () => {
    const objects = new Map<string, Uint8Array>();
    const store: ArtifactStore = {
      uploadDirectory: vi.fn((id: string) => { objects.set(`${id}/index.html`, new TextEncoder().encode('hello')); return Promise.resolve(); }),
      copyArtifact: vi.fn((source: string, destination: string) => { const body = objects.get(`${source}/index.html`); if (!body) return Promise.reject(new Error('Source missing')); objects.set(`${destination}/index.html`, body); return Promise.resolve(); }),
      readObject: vi.fn((id: string, path: string) => { const body = objects.get(`${id}/${path}`); return Promise.resolve(body ? { body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(body); controller.close(); } }) } : null); }),
      deleteArtifact: vi.fn((id: string) => { for (const objectKey of objects.keys()) if (objectKey.startsWith(`${id}/`)) objects.delete(objectKey); return Promise.resolve(); }),
    };
    await store.uploadDirectory('draft', '/ignored'); await store.copyArtifact('draft', 'release');
    const release = await store.readObject('release', 'index.html'); expect(release).not.toBeNull();
    if (!release) throw new Error('Release missing');
    expect(await new Response(release.body).text()).toBe('hello');
    await store.deleteArtifact('draft'); expect(await store.readObject('draft', 'index.html')).toBeNull();
  });
  it('keeps queue and email payloads free of provider headers', async () => {
    const messages: OperationMessage[] = []; const queue: OperationQueue = { enqueue: (message) => { messages.push(message); return Promise.resolve(); } };
    const deliveries: unknown[] = []; const email: TransactionalEmailSender = { sendMagicLink: (input) => { deliveries.push(input); return Promise.resolve(); } };
    await queue.enqueue({ version: 1, operationId: '11111111-1111-4111-8111-111111111111', traceId: 'trace', createdAt: new Date().toISOString() });
    await email.sendMagicLink({ to: 'writer@example.com', url: 'https://example.com/magic', expiresAt: new Date(), idempotencyKey: 'token-hash' });
    expect(messages[0]).not.toHaveProperty('x-cloudtasks-queuename'); expect(deliveries[0]).not.toHaveProperty('resendApiKey');
  });
});
