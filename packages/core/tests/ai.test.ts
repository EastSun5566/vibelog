import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderRequestError, AiProviderTimeoutError, FallbackAiProvider, PiAiProvider, createAiProvider } from '../src/adapters/ai/index.js';
import type { AiProvider } from '../src/types.js';
import { DEFAULT_DESIGN_V2 } from '../src/design/defaults-v2.js';

const input = { blog: { title: 'Blog', description: 'Writing', author: 'Writer' }, contentProfile: { postCount: 5, tagCount: 3, averageLength: 'medium' as const, codeUsage: 'some' as const, imageUsage: 'none' as const, mathUsage: 'none' as const }, currentDesign: DEFAULT_DESIGN_V2, prompt: 'Editorial' };
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('PiAiProvider design proposal', () => {
  it.each([
    ['qwen3.8-flash', 'anthropic-messages'],
    ['glm-5.3-flash', 'openai-completions'],
  ] as const)('supports OpenCode Go model %s', (modelId, api) => {
    const provider = createAiProvider('opencode-go', modelId);
    expect(provider.name).toBe('opencode-go');
    expect(provider.modelId).toBe(modelId);
    expect(provider.model.api).toBe(api);
  });
  it('returns a valid single tool proposal', async () => {
    const response = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
    await expect(subject([response]).generate(input)).resolves.toEqual(DEFAULT_DESIGN_V2);
  });
  it('normalizes an otherwise valid V2 proposal', async () => {
    const proposal = structuredClone(DEFAULT_DESIGN_V2);
    proposal.theme.colors.background = '#FFFFFF';
    proposal.pages.home.presentation = {};
    const response = fauxAssistantMessage(fauxToolCall('propose_design', proposal), { stopReason: 'toolUse' });
    await expect(subject([response]).generate(input)).resolves.toEqual(DEFAULT_DESIGN_V2);
  });
  it('accepts a monospaced body for a terminal theme', async () => {
    const terminalTheme = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, appearance: 'dark' as const, typography: { ...DEFAULT_DESIGN_V2.theme.typography, bodyFont: 'system-mono' as const, headingFont: 'system-mono' as const } } };
    const response = fauxAssistantMessage(fauxToolCall('propose_design', terminalTheme), { stopReason: 'toolUse' });
    await expect(subject([response]).generate({ ...input, prompt: 'dark blue that feel like terminal' })).resolves.toEqual(terminalTheme);
  });
  it('passes a concise validation path to the corrective request and final internal error', async () => {
    const invalid = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, typography: { ...DEFAULT_DESIGN_V2.theme.typography, bodyFont: 'display' } } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_design', invalid), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
    const { provider, complete } = instrumentedSubject('opencode-go', [bad, good]);

    await expect(provider.generate(input, { sessionId: 'operation-1' })).resolves.toEqual(DEFAULT_DESIGN_V2);
    const correctionPrompt = complete.mock.calls[1]?.[1].systemPrompt;
    expect(correctionPrompt).toContain('bodyFont');
    expect(correctionPrompt).not.toContain('Received arguments');
    expect(correctionPrompt).not.toContain('display');

    await expect(instrumentedSubject('opencode-go', [bad, bad]).provider.generate(input, { sessionId: 'operation-2' }))
      .rejects.toThrow(/bodyFont.*current design was not changed/su);
  });
  it('retries one invalid contrast proposal and preserves a stable final error', async () => {
    const invalid = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, colors: { ...DEFAULT_DESIGN_V2.theme.colors, text: '#eeeeee' } } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_design', invalid), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
    await expect(subject([bad, good]).generate(input)).resolves.toEqual(DEFAULT_DESIGN_V2);
    await expect(subject([bad, bad]).generate(input)).rejects.toThrow('current design was not changed');
  });
  it('sends stable OpenCode session metadata without adding it to the model prompt', async () => {
    const invalid = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, colors: { ...DEFAULT_DESIGN_V2.theme.colors, text: '#eeeeee' } } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_design', invalid), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
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
    const response = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
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
    const failure = await provider.generate(input, { sessionId: 'operation-1' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiProviderRequestError);
    expect(failure).toMatchObject({ kind: 'http', retryable: false, status: 400 });
    expect(requestHeaders?.get('x-opencode-session')).toBe('operation-1');
    expect(requestHeaders?.get('user-agent')).toBe('VibeLog');
  });
  it.each([404, 408, 409, 429, 500])('classifies OpenCode HTTP %i as retryable', async (status) => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'not available' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    }));

    const failure = await createAiProvider('opencode-go', 'qwen3.8-flash').generate(input, { sessionId: 'operation-1' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'http', retryable: true, status });
    expect((failure as Error).message).not.toContain('not available');
  });
  it('classifies network errors as retryable without exposing their details', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private transport detail'));

    const failure = await createAiProvider('opencode-go', 'qwen3.8-flash').generate(input, { sessionId: 'operation-1' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'network', retryable: true });
    expect((failure as Error).message).not.toContain('private transport detail');
  });
  it('honors the provider retry override header', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'retry elsewhere' } }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'x-should-retry': 'true' },
    }));

    const failure = await createAiProvider('opencode-go', 'qwen3.8-flash').generate(input, { sessionId: 'operation-1' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'http', retryable: true, status: 400 });
  });
  it('sends GLM-5.3-Flash through the OpenCode Go chat completions transport', async () => {
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

    const provider = createAiProvider('opencode-go', 'glm-5.3-flash');
    await expect(provider.generate(input, { sessionId: 'operation-1' })).rejects.toBeInstanceOf(AiProviderRequestError);
    expect(requestUrl).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(requestHeaders?.get('x-opencode-session')).toBe('operation-1');
    expect(requestHeaders?.get('user-agent')).toBe('VibeLog');
  });
  it('aborts a provider that does not respond before the generation deadline', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      const signal = request instanceof Request ? request.signal : options?.signal;
      requestStarted();
      return new Promise((_resolve, reject) => {
        if (!signal) { reject(new Error('Missing abort signal')); return; }
        const rejectAbort = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('Request aborted')); };
        if (signal.aborted) { rejectAbort(); return; }
        signal.addEventListener('abort', () => { rejectAbort(); }, { once: true });
      });
    });
    const controller = new AbortController();
    const pending = createAiProvider('opencode-go', 'qwen3.8-flash').generate(input, { sessionId: 'operation-1', signal: controller.signal });
    await started;
    controller.abort(new DOMException('AI deadline reached', 'TimeoutError'));

    await expect(pending).rejects.toBeInstanceOf(AiProviderTimeoutError);
  });
  it('preserves provider failures from the corrective request', async () => {
    const invalid = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, colors: { ...DEFAULT_DESIGN_V2.theme.colors, text: '#eeeeee' } } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_design', invalid), { stopReason: 'toolUse' });
    const unavailable = fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'upstream unavailable' });
    await expect(subject([bad, unavailable]).generate(input)).rejects.toBeInstanceOf(AiProviderRequestError);
  });
  it('falls back sequentially for retryable provider failures with the same session ID', async () => {
    const primaryGenerate = vi.fn<AiProvider['generate']>(() => Promise.reject(new AiProviderRequestError('rate limited', { kind: 'http', retryable: true, status: 429 })));
    const fallbackGenerate = vi.fn<AiProvider['generate']>(() => Promise.resolve(DEFAULT_DESIGN_V2));
    const providers = new Map<string, AiProvider>([
      ['qwen3.8-flash', { name: 'opencode-go', modelId: 'qwen3.8-flash', generate: primaryGenerate }],
      ['glm-5.3-flash', { name: 'opencode-go', modelId: 'glm-5.3-flash', generate: fallbackGenerate }],
    ]);
    const provider = new FallbackAiProvider('opencode-go', 'qwen3.8-flash', ['glm-5.3-flash'], (_name, modelId) => {
      const candidate = providers.get(modelId);
      if (!candidate) throw new Error(`Missing test provider: ${modelId}`);
      return candidate;
    });

    await expect(provider.generate(input, { sessionId: 'operation-1' })).resolves.toEqual(DEFAULT_DESIGN_V2);
    expect(primaryGenerate).toHaveBeenCalledOnce();
    expect(fallbackGenerate).toHaveBeenCalledOnce();
    expect(primaryGenerate.mock.calls[0]?.[1]?.sessionId).toBe('operation-1');
    expect(fallbackGenerate.mock.calls[0]?.[1]?.sessionId).toBe('operation-1');
  });
  it.each([
    new AiProviderRequestError('bad request', { kind: 'http', retryable: false, status: 400 }),
    new AiProviderRequestError('unauthorized', { kind: 'http', retryable: false, status: 401 }),
    new AiProviderRequestError('forbidden', { kind: 'http', retryable: false, status: 403 }),
    new AiProviderRequestError('cancelled', { kind: 'cancelled', retryable: false }),
    new Error('invalid theme'),
  ])('does not fall back for permanent or validation failures: %s', async (failure) => {
    const primaryGenerate = vi.fn<AiProvider['generate']>(() => Promise.reject(failure));
    const fallbackGenerate = vi.fn<AiProvider['generate']>(() => Promise.resolve(DEFAULT_DESIGN_V2));
    const provider = new FallbackAiProvider('opencode-go', 'qwen3.8-flash', ['glm-5.3-flash'], (_name, modelId) => ({
      name: 'opencode-go', modelId, generate: modelId === 'qwen3.8-flash' ? primaryGenerate : fallbackGenerate,
    }));

    await expect(provider.generate(input, { sessionId: 'operation-1' })).rejects.toBe(failure);
    expect(fallbackGenerate).not.toHaveBeenCalled();
  });
  it('falls back when the corrective request encounters an upstream failure', async () => {
    const invalid = { ...DEFAULT_DESIGN_V2, theme: { ...DEFAULT_DESIGN_V2.theme, colors: { ...DEFAULT_DESIGN_V2.theme.colors, text: '#eeeeee' } } };
    const bad = fauxAssistantMessage(fauxToolCall('propose_design', invalid), { stopReason: 'toolUse' });
    const unavailable = fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'upstream unavailable' });
    const good = fauxAssistantMessage(fauxToolCall('propose_design', DEFAULT_DESIGN_V2), { stopReason: 'toolUse' });
    const primary = subject([bad, unavailable]);
    const fallback = subject([good]);
    const provider = new FallbackAiProvider('test', 'primary', ['fallback'], (_name, modelId) => modelId === 'primary' ? primary : fallback);

    await expect(provider.generate(input, { sessionId: 'operation-1' })).resolves.toEqual(DEFAULT_DESIGN_V2);
  });
  it('uses a 45-second deadline for each model candidate', async () => {
    const stalled: AiProvider = {
      name: 'opencode-go', modelId: 'qwen3.8-flash',
      generate: (_input, context) => new Promise((_resolve, reject) => context?.signal?.addEventListener('abort', () => { reject(new AiProviderTimeoutError()); }, { once: true })),
    };
    const fallbackGenerate = vi.fn<AiProvider['generate']>(() => Promise.resolve(DEFAULT_DESIGN_V2));
    const fallback: AiProvider = { name: 'opencode-go', modelId: 'glm-5.3-flash', generate: fallbackGenerate };
    const provider = new FallbackAiProvider('opencode-go', stalled.modelId, [fallback.modelId], (_name, modelId) => modelId === stalled.modelId ? stalled : fallback, 5);
    await expect(provider.generate(input, { sessionId: 'operation-1' })).resolves.toEqual(DEFAULT_DESIGN_V2);
    expect(fallbackGenerate).toHaveBeenCalledOnce();
  });
  it('rejects duplicate or empty fallback model IDs', () => {
    expect(() => new FallbackAiProvider('opencode-go', 'qwen3.8-flash', ['qwen3.8-flash'])).toThrow('must be unique');
    expect(() => new FallbackAiProvider('opencode-go', 'qwen3.8-flash', [''])).toThrow('must not be empty');
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
