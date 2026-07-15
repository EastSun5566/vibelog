import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PiAiProvider,
  createAiProvider,
  getAiProviderNames,
} from '../../../src/adapters/ai/index.js';

vi.mock('../../../src/core/index.js', () => ({
  logger: { info: vi.fn() },
}));

const validResult = {
  variables: [
    { name: '--primary-color', value: '#3b82f6' },
    { name: '--secondary-color', value: '#ef4444' },
  ],
  description: 'A modern blue and red color scheme',
};

function fauxSubject(
  response: FauxResponseStep,
  provider = 'test-provider',
  modelId = 'test-model',
) {
  const faux = fauxProvider({ provider, models: [{ id: modelId }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([response]);
  return {
    faux,
    subject: new PiAiProvider(provider, modelId, models),
  };
}

function successfulToolCall() {
  return fauxAssistantMessage(
    fauxToolCall('submit_css_transform', validResult),
    { stopReason: 'toolUse' },
  );
}

describe('PiAiProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the validated tool result', async () => {
    const { subject } = fauxSubject(successfulToolCall());

    await expect(subject.generate('Create a blue theme')).resolves.toEqual(validResult);
  });

  it('rejects invalid tool arguments', async () => {
    const response = fauxAssistantMessage(
      fauxToolCall('submit_css_transform', { variables: 'invalid' }),
      { stopReason: 'toolUse' },
    );
    const { subject } = fauxSubject(response);

    await expect(subject.generate('test')).rejects.toThrow();
  });

  it('rejects text-only responses', async () => {
    const { subject } = fauxSubject(fauxAssistantMessage(fauxText('plain text')));

    await expect(subject.generate('test')).rejects.toThrow(
      'AI must call submit_css_transform exactly once.',
    );
  });

  it('rejects multiple tool calls', async () => {
    const response = fauxAssistantMessage([
      fauxToolCall('submit_css_transform', validResult),
      fauxToolCall('submit_css_transform', validResult),
    ], { stopReason: 'toolUse' });
    const { subject } = fauxSubject(response);

    await expect(subject.generate('test')).rejects.toThrow(
      'AI must call submit_css_transform exactly once.',
    );
  });

  it('returns a stable provider error', async () => {
    process.env.OPENAI_API_KEY = 'sensitive-test-key';
    const response = fauxAssistantMessage([], {
      stopReason: 'error',
      errorMessage: 'provider unavailable: sensitive-test-key',
    });
    const { subject } = fauxSubject(response);

    const request = subject.generate('test');
    await expect(request).rejects.toThrow('provider unavailable: [REDACTED]');
    await expect(request).rejects.not.toThrow('sensitive-test-key');
  });

  it('returns a stable cancellation error', async () => {
    const response = fauxAssistantMessage([], {
      stopReason: 'aborted',
      errorMessage: 'Request was aborted',
    });
    const { subject } = fauxSubject(response);

    await expect(subject.generate('test')).rejects.toThrow(
      'AI provider request failed: Request was aborted',
    );
  });

  it('rejects responses that hit the output limit', async () => {
    const { subject } = fauxSubject(fauxAssistantMessage([], { stopReason: 'length' }));

    await expect(subject.generate('test')).rejects.toThrow(
      'AI response exceeded the model output limit.',
    );
  });

  it('rejects an unexpected tool name', async () => {
    const response = fauxAssistantMessage(
      fauxToolCall('other_tool', validResult),
      { stopReason: 'toolUse' },
    );
    const { subject } = fauxSubject(response);

    await expect(subject.generate('test')).rejects.toThrow(
      'AI called an unexpected tool: other_tool',
    );
  });

  it('wraps provider exceptions without exposing request details', async () => {
    const { subject } = fauxSubject(() => {
      throw new Error('network unavailable');
    });

    await expect(subject.generate('test')).rejects.toThrow(
      'AI provider request failed: network unavailable',
    );
  });

  it('rejects unknown providers and catalog models before a request', () => {
    expect(() => new PiAiProvider('unsupported', 'model')).toThrow(
      'Unsupported AI provider: unsupported',
    );

    const faux = fauxProvider({ provider: 'test-provider', models: [{ id: 'known-model' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    expect(() => new PiAiProvider('test-provider', 'unknown-model', models)).toThrow(
      'Unknown AI model: test-provider@unknown-model',
    );
  });

  it('passes the legacy Google key as a request-scoped GEMINI_API_KEY fallback', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'legacy-test-key';
    const { subject } = fauxSubject((_context, options) => {
      expect(options?.env).toEqual({ GEMINI_API_KEY: 'legacy-test-key' });
      return successfulToolCall();
    }, 'google', 'test-google');

    await expect(subject.generate('test')).resolves.toEqual(validResult);
  });

  it('does not override the canonical Google key', async () => {
    process.env.GEMINI_API_KEY = 'canonical-test-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'legacy-test-key';
    const { subject } = fauxSubject((_context, options) => {
      expect(options?.env).toBeUndefined();
      return successfulToolCall();
    }, 'google', 'test-google');

    await expect(subject.generate('test')).resolves.toEqual(validResult);
  });

  it('registers all built-in providers and Ollama', () => {
    expect(getAiProviderNames()).toEqual(expect.arrayContaining([
      'openai',
      'anthropic',
      'google',
      'groq',
      'nvidia',
      'mistral',
      'xai',
      'ollama',
    ]));
  });

  it('uses the pi-ai catalog endpoints for hosted providers', () => {
    const groq = createAiProvider('groq', 'openai/gpt-oss-20b');
    const nvidia = createAiProvider('nvidia', 'nvidia/nemotron-3-super-120b-a12b');
    const mistral = createAiProvider('mistral', 'devstral-medium-latest');
    const xai = createAiProvider('xai', 'grok-code-fast-1');

    expect(groq.model).toMatchObject({
      id: 'openai/gpt-oss-20b',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    expect(nvidia.model).toMatchObject({
      id: 'nvidia/nemotron-3-super-120b-a12b',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    });
    expect(mistral.model).toMatchObject({
      id: 'devstral-medium-latest',
      baseUrl: 'https://api.mistral.ai',
    });
    expect(xai.model).toMatchObject({
      id: 'grok-code-fast-1',
      baseUrl: 'https://api.x.ai/v1',
    });
  });

  it('accepts arbitrary Ollama model IDs and honors OLLAMA_BASE_URL', () => {
    process.env.OLLAMA_BASE_URL = 'http://ollama.internal:11434/v1';
    const provider = createAiProvider('ollama', 'local/custom-model');

    expect(provider.name).toBe('ollama');
    expect(provider.model.id).toBe('local/custom-model');
    expect(provider.model.baseUrl).toBe('http://ollama.internal:11434/v1');
  });
});
