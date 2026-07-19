import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiAiProvider, createAiProvider } from '../src/adapters/ai/index.js';
import { DEFAULT_THEME } from '../src/theme.js';

const input = { blog: { title: 'Blog', description: 'Writing', author: 'Writer' }, currentTheme: DEFAULT_THEME, prompt: 'Editorial' };
function subject(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) {
  const faux = fauxProvider({ provider: 'test', models: [{ id: 'model' }] });
  const models = createModels(); models.setProvider(faux.provider); faux.setResponses(responses);
  return new PiAiProvider('test', 'model', models);
}
afterEach(() => vi.restoreAllMocks());
describe('PiAiProvider theme proposal', () => {
  it('returns a valid single tool proposal', async () => {
    const response = fauxAssistantMessage(fauxToolCall('propose_theme', DEFAULT_THEME), { stopReason: 'toolUse' });
    await expect(subject([response]).generate(input)).resolves.toEqual(DEFAULT_THEME);
  });
  it('retries one invalid contrast proposal and preserves a stable final error', async () => {
    const invalid = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#eeeeee' } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_theme', invalid), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('propose_theme', DEFAULT_THEME), { stopReason: 'toolUse' });
    await expect(subject([bad, good]).generate(input)).resolves.toEqual(DEFAULT_THEME);
    await expect(subject([bad, bad]).generate(input)).rejects.toThrow('current design was not changed');
  });
  it('calls Ollama without requiring or sending an API key', async () => {
    let requestUrl: string | undefined;
    let requestHeaders: Headers | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, init) => {
      requestUrl = request instanceof Request ? request.url : String(request);
      requestHeaders = request instanceof Request ? request.headers : new Headers(init?.headers);
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'offline test' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }));
    });

    const provider = createAiProvider('ollama', 'gemma4:31b-cloud');
    await expect(provider.generate(input)).rejects.not.toThrow('No API key');
    expect(requestUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(requestHeaders?.has('authorization')).toBe(false);
  });
});
