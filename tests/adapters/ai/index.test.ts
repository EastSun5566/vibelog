import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VercelAiProvider } from '../../../src/adapters/ai/index';
import { AiProviderName } from '../../../src/consts';

// Mock external dependencies
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));
vi.mock('ollama-ai-provider', () => ({
  createOllama: vi.fn(() => () => ({ id: 'mock-model' })),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => () => ({ id: 'mock-model' })),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => () => ({ id: 'mock-model' })),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => () => ({ id: 'mock-model' })),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => () => ({ id: 'mock-model' })),
}));
vi.mock('../../../src/core', () => ({
  logger: {
    info: vi.fn(),
  },
}));

describe('VercelAiProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create Ollama provider successfully', () => {
      const provider = new VercelAiProvider(AiProviderName.OLLAMA, 'llama2');

      expect(provider.name).toBe(AiProviderName.OLLAMA);
      expect(provider.modelId).toBe('llama2');
      expect(provider.model).not.toBeNull();
    });

    it('should create OpenAI provider successfully with API key', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const provider = new VercelAiProvider(AiProviderName.OPENAI, 'gpt-4');

      expect(provider.name).toBe(AiProviderName.OPENAI);
      expect(provider.modelId).toBe('gpt-4');
      expect(provider.model).not.toBeNull();
    });

    it('should throw error for OpenAI provider without API key', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => {
        new VercelAiProvider(AiProviderName.OPENAI, 'gpt-4');
      }).toThrow('OPENAI_API_KEY environment variable is required.');
    });

    it('should create Anthropic provider successfully with API key', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      const provider = new VercelAiProvider(AiProviderName.ANTHROPIC, 'claude-3');

      expect(provider.name).toBe(AiProviderName.ANTHROPIC);
      expect(provider.modelId).toBe('claude-3');
      expect(provider.model).not.toBeNull();
    });

    it('should throw error for Anthropic provider without API key', () => {
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => {
        new VercelAiProvider(AiProviderName.ANTHROPIC, 'claude-3');
      }).toThrow('ANTHROPIC_API_KEY environment variable is required.');
    });

    it('should create Google provider successfully with API key', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';

      const provider = new VercelAiProvider(AiProviderName.GOOGLE, 'gemini-pro');

      expect(provider.name).toBe(AiProviderName.GOOGLE);
      expect(provider.modelId).toBe('gemini-pro');
      expect(provider.model).not.toBeNull();
    });

    it('should throw error for Google provider without API key', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

      expect(() => {
        new VercelAiProvider(AiProviderName.GOOGLE, 'gemini-pro');
      }).toThrow('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required.');
    });

    it('should create OpenRouter provider successfully with API key', () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const provider = new VercelAiProvider(AiProviderName.OPENROUTER, 'openrouter/model');

      expect(provider.name).toBe(AiProviderName.OPENROUTER);
      expect(provider.modelId).toBe('openrouter/model');
      expect(provider.model).not.toBeNull();
    });

    it('should throw error for OpenRouter provider without API key', () => {
      delete process.env.OPENROUTER_API_KEY;

      expect(() => {
        new VercelAiProvider(AiProviderName.OPENROUTER, 'openrouter/model');
      }).toThrow('OPENROUTER_API_KEY environment variable is required.');
    });

    it('should throw error for unsupported provider', () => {
      expect(() => {
        new VercelAiProvider('unsupported' as AiProviderName, 'model');
      }).toThrow('Unsupported AI provider: unsupported. Supported: openai, anthropic, ollama, google, openrouter');
    });
  });

  describe('generate', () => {
    it('should generate CSS transformation successfully', async () => {
      const { generateObject } = await import('ai');

      const mockResult = {
        variables: [
          { name: '--primary-color', value: '#3b82f6' },
          { name: '--secondary-color', value: '#ef4444' },
        ],
        description: 'A modern blue and red color scheme',
      };

      // Mock the generateObject function
      const mockGenerateObject = vi.mocked(generateObject);
      // @ts-expect-error - simplified mock for testing
      mockGenerateObject.mockResolvedValue({
        object: mockResult,
      });

      const provider = new VercelAiProvider(AiProviderName.OLLAMA, 'llama2');
      const result = await provider.generate('Create a blue theme');

      expect(result).toEqual(mockResult);
      expect(generateObject).toHaveBeenCalled();
    });

    it('should include JSON mode for OpenRouter provider', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';

      const { generateObject } = await import('ai');

      const mockResult = {
        variables: [{ name: '--color', value: '#000' }],
        description: 'Test theme',
      };

      const mockGenerateObject = vi.mocked(generateObject);
      // @ts-expect-error - simplified mock for testing
      mockGenerateObject.mockResolvedValue({
        object: mockResult,
      });

      const provider = new VercelAiProvider(AiProviderName.OPENROUTER, 'model');
      await provider.generate('test prompt');

      // Check that generateObject was called with mode: 'json'
      expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'json',
        }),
      );
    });

    it('should throw error when model is not initialized', async () => {
      const provider = new VercelAiProvider(AiProviderName.OLLAMA, 'llama2');
      // Manually set model to null to simulate initialization failure
      Object.defineProperty(provider, 'model', { value: null, writable: true });

      await expect(provider.generate('test prompt')).rejects.toThrow(
        'AI model is not initialized. Check provider and model name.',
      );
    });

    it('should handle generateObject errors', async () => {
      const { generateObject } = await import('ai');

      const error = new Error('API call failed');
      vi.mocked(generateObject).mockRejectedValue(error);

      const provider = new VercelAiProvider(AiProviderName.OLLAMA, 'llama2');

      await expect(provider.generate('test prompt')).rejects.toThrow('API call failed');
    });
  });
});
