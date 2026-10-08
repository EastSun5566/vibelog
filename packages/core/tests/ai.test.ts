import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderRequestError, AiProviderTimeoutError, FallbackAiProvider, PiAiProvider, createAiProvider } from '../src/adapters/ai/index.js';
import type { AiProvider } from '../src/types.js';
import { DEFAULT_DESIGN_V2 } from '../src/design/defaults-v2.js';
import { designToolV2, refineDesignToolV2 } from '../src/adapters/ai/tool-v2.js';

const input = { blog: { title: 'Blog', description: 'Writing', author: 'Writer' }, contentProfile: { postCount: 5, tagCount: 3, averageLength: 'medium' as const, codeUsage: 'some' as const, imageUsage: 'none' as const, mathUsage: 'none' as const }, currentDesign: DEFAULT_DESIGN_V2, prompt: 'Editorial' };
function parseRequestBody(options?: RequestInit): unknown {
  if (typeof options?.body !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(options.body);
}
function anthropicToolResponse(design: typeof DEFAULT_DESIGN_V2) {
  const events = [
    { type: 'message_start', message: { id: 'test', type: 'message', role: 'assistant', model: 'qwen3.8-flash', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'proposal', name: 'propose_design', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(design) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
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
  it('lets the model choose a focused refinement in the same request', async () => {
    const response = fauxAssistantMessage(fauxToolCall('refine_design', { patches: [{ op: 'replace', path: '/theme/layout/radius', value: 'round' }] }), { stopReason: 'toolUse' });
    const { provider, complete } = instrumentedSubject('test', [response]);
    const result = await provider.generate({ ...input, prompt: 'Make the corners softer' });
    expect(result.theme.layout.radius).toBe('round');
    expect(result.pages).toEqual(input.currentDesign.pages);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[1].tools?.map((tool) => tool.name)).toEqual(['propose_design', 'refine_design']);
    expect(complete.mock.calls[0]?.[1].systemPrompt).toContain('Prefer refine_design for a focused or ambiguous request');
  });
  it('keeps the refinement mode during one correction', async () => {
    const bad = fauxAssistantMessage(fauxToolCall('refine_design', { patches: [{ op: 'replace', path: '/theme/typography/bodyFont', value: 'comic' }] }), { stopReason: 'toolUse' });
    const good = fauxAssistantMessage(fauxToolCall('refine_design', { patches: [{ op: 'replace', path: '/theme/typography/bodyFont', value: 'system-mono' }] }), { stopReason: 'toolUse' });
    const { provider, complete } = instrumentedSubject('test', [bad, good]);
    await expect(provider.generate(input, { sessionId: 'operation-1' })).resolves.toMatchObject({ theme: { typography: { bodyFont: 'system-mono' } } });
    expect(complete.mock.calls[1]?.[1].tools?.map((tool) => tool.name)).toEqual(['refine_design']);
    expect(complete.mock.calls[1]?.[1].systemPrompt).toContain('bodyFont');
    expect(complete.mock.calls[1]?.[1].systemPrompt).not.toContain('create a complete version 2 VibeLog design');
    expect(complete.mock.calls[1]?.[1].systemPrompt).not.toContain('comic');
    await expect(subject([bad, bad]).generate(input)).rejects.toThrow('current design was not changed');
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
    expect(correctionPrompt).toContain('For propose_design, create a complete version 2 VibeLog design');
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
      expect.objectContaining({ sessionId: 'operation-1', maxRetries: 0, headers: { 'user-agent': 'VibeLog' } }),
      expect.objectContaining({ sessionId: 'operation-1', maxRetries: 0, headers: { 'user-agent': 'VibeLog' } }),
      expect.objectContaining({ sessionId: 'operation-2', maxRetries: 0, headers: { 'user-agent': 'VibeLog' } }),
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
    let requestBody: { tools: { name: string; input_schema: unknown }[] } | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      requestHeaders = request instanceof Request ? request.headers : new Headers(options?.headers);
      requestBody = parseRequestBody(options) as typeof requestBody;
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
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(requestBody?.tools.map((tool) => ({ name: tool.name, parameters: tool.input_schema })))
      .toEqual([designToolV2, refineDesignToolV2].map((tool) => ({ name: tool.name, parameters: tool.parameters }))
        .map(({ name, parameters }) => ({ name, parameters: { type: 'object', properties: parameters.properties, required: parameters.required } })));
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
    expect(globalThis.fetch).toHaveBeenCalledOnce();
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
    let requestBody: { tools: { function: { name: string; parameters: unknown } }[] } | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      requestUrl = request instanceof Request ? request.url : String(request);
      requestHeaders = request instanceof Request ? request.headers : new Headers(options?.headers);
      requestBody = parseRequestBody(options) as typeof requestBody;
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
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(requestBody?.tools.map((tool) => ({ name: tool.function.name, parameters: tool.function.parameters })))
      .toEqual([designToolV2, refineDesignToolV2].map((tool) => ({ name: tool.name, parameters: tool.parameters })));
  });
  it('keeps the legacy Azure provider name mapped to the current catalog', () => {
    const [model] = getBuiltinModels('azure');
    expect(model).toBeDefined();
    const legacy = createAiProvider('azure-openai-responses', model.id);
    const current = createAiProvider('azure', model.id);
    expect(legacy.name).toBe('azure-openai-responses');
    expect(legacy.model).toEqual(current.model);
    expect(legacy.model.provider).toBe('azure');
  });
  it('keeps the native session header and validated schema during a transport correction', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    const invalid = structuredClone(DEFAULT_DESIGN_V2);
    invalid.theme.colors.text = invalid.theme.colors.background;
    const headers: Headers[] = [];
    const bodies: { tools: { name: string }[] }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_request, options) => {
      headers.push(new Headers(options?.headers));
      bodies.push(parseRequestBody(options) as typeof bodies[number]);
      return Promise.resolve(anthropicToolResponse(bodies.length === 1 ? invalid : DEFAULT_DESIGN_V2));
    });
    await expect(createAiProvider('opencode-go', 'qwen3.8-flash').generate(input, { sessionId: 'correction-session' })).resolves.toEqual(DEFAULT_DESIGN_V2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(headers.map((header) => header.get('x-opencode-session'))).toEqual(['correction-session', 'correction-session']);
    expect(bodies.map((body) => body.tools.map((tool) => tool.name))).toEqual([['propose_design', 'refine_design'], ['propose_design']]);
    expect(JSON.stringify(bodies)).not.toContain('correction-session');
  });
  it('keeps native session affinity across both transports without hidden retries', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'test-key');
    const requests: { url: string; session: string | null }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((request, options) => {
      const url = request instanceof Request ? request.url : String(request);
      const headers = request instanceof Request ? request.headers : new Headers(options?.headers);
      requests.push({ url, session: headers.get('x-opencode-session') });
      return Promise.resolve(new Response(JSON.stringify({ error: { type: 'api_error', message: 'offline test' } }), {
        status: requests.length === 1 ? 429 : 400, headers: { 'content-type': 'application/json' },
      }));
    });
    const provider = new FallbackAiProvider('opencode-go', 'qwen3.8-flash', ['glm-5.3-flash']);
    await expect(provider.generate(input, { sessionId: 'fallback-session' })).rejects.toMatchObject({ status: 400 });
    expect(requests).toEqual([
      { url: 'https://opencode.ai/zen/go/v1/messages?beta=true', session: 'fallback-session' },
      { url: 'https://opencode.ai/zen/go/v1/chat/completions', session: 'fallback-session' },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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
