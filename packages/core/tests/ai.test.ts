import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderRequestError, PiAiProvider, createAiProvider } from '../src/adapters/ai/index.js';
import { DEFAULT_THEME } from '../src/theme.js';

const input = { blog: { title: 'Blog', description: 'Writing', author: 'Writer' }, currentTheme: DEFAULT_THEME, prompt: 'Editorial' };
function subject(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) {
  const faux = fauxProvider({ provider: 'test', models: [{ id: 'model' }] });
  const models = createModels(); models.setProvider(faux.provider); faux.setResponses(responses);
  return new PiAiProvider('test', 'model', models);
}
function instrumentedSubject(providerName: string, responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) {
  const faux = fauxProvider({ provider: providerName, models: [{ id: 'model' }] });
  const models = createModels(); models.setProvider(faux.provider); faux.setResponses(responses);
  return { provider: new PiAiProvider(providerName, 'model', models), complete: vi.spyOn(models, 'complete') };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('PiAiProvider theme proposal', () => {
  it('supports the OpenCode Go provider catalog', () => {
    const provider = createAiProvider('opencode-go', 'deepseek-v4.1-flash');
    expect(provider.name).toBe('opencode-go');
    expect(provider.modelId).toBe('deepseek-v4.1-flash');
    expect(provider.model.api).toBe('openai-completions');
  });
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
  it('sends stable OpenCode session metadata without adding it to the model prompt', async () => {
    const invalid = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#eeeeee' } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_theme', invalid), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('propose_theme', DEFAULT_THEME), { stopReason: 'toolUse' });
    const { provider, complete } = instrumentedSubject('opencode-go', [bad, good, good]);

    await provider.generate(input, { sessionId: 'operation-1' });
    await provider.generate(input, { sessionId: 'operation-2' });

    expect(complete.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({ sessionId: 'operation-1', headers: { 'user-agent': 'VibeLog', 'x-opencode-session': 'operation-1' } }),
      expect.objectContaining({ sessionId: 'operation-1', headers: { 'user-agent': 'VibeLog', 'x-opencode-session': 'operation-1' } }),
      expect.objectContaining({ sessionId: 'operation-2', headers: { 'user-agent': 'VibeLog', 'x-opencode-session': 'operation-2' } }),
    ]);
    expect(complete.mock.calls.map((call) => JSON.stringify(call[1]))).not.toContainEqual(expect.stringContaining('operation-'));
  });
  it('does not send OpenCode session metadata to other providers', async () => {
    const response = fauxAssistantMessage(fauxToolCall('propose_theme', DEFAULT_THEME), { stopReason: 'toolUse' });
    const { provider, complete } = instrumentedSubject('test', [response]);
    await provider.generate(input, { sessionId: 'operation-1' });
    expect(complete.mock.calls[0]?.[2]).not.toHaveProperty('sessionId');
    expect(complete.mock.calls[0]?.[2]).not.toHaveProperty('headers');
  });
  it('sends the session metadata through the Anthropic transport', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    let requestHeaders: Headers | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      requestHeaders = request instanceof Request ? request.headers : new Headers(options?.headers);
      return Promise.resolve(new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'offline test' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }));
    });

    const provider = createAiProvider('opencode-go', 'qwen3.8-flash');
    await expect(provider.generate(input, { sessionId: 'operation-1' })).rejects.toBeInstanceOf(AiProviderRequestError);
    expect(requestHeaders?.get('x-opencode-session')).toBe('operation-1');
    expect(requestHeaders?.get('user-agent')).toBe('VibeLog');
  });
  it('sends DeepSeek V4.1 Flash through the OpenCode Go chat completions transport', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    let requestUrl: string | undefined;
    let requestHeaders: Headers | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      requestUrl = request instanceof Request ? request.url : String(request);
      requestHeaders = request instanceof Request ? request.headers : new Headers(options?.headers);
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'offline test' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }));
    });

    const provider = createAiProvider('opencode-go', 'deepseek-v4.1-flash');
    await expect(provider.generate(input, { sessionId: 'operation-1' })).rejects.toBeInstanceOf(AiProviderRequestError);
    expect(requestUrl).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(requestHeaders?.get('x-opencode-session')).toBe('operation-1');
    expect(requestHeaders?.get('user-agent')).toBe('VibeLog');
  });
  it('preserves provider failures from the corrective request', async () => {
    const invalid = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#eeeeee' } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_theme', invalid), { stopReason: 'toolUse' });
    const unavailable = fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'upstream unavailable' });
    await expect(subject([bad, unavailable]).generate(input)).rejects.toBeInstanceOf(AiProviderRequestError);
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
