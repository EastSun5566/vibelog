import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StyleTransformer, createStyleTransformer } from '../../src/core/transformer';
import { CssParser } from '../../src/core/parser';
import { AiProviderName } from '../../src/consts';
import type { AiProvider, CssVariable } from '../../src/types';

// Mock dependencies
vi.mock('../../src/core/parser');
vi.mock('../../src/core/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const MockCssParser = vi.mocked(CssParser);

describe('Transformer', () => {
  let mockAiProvider: AiProvider;
  let mockCssParser: {
    extractVariables: ReturnType<typeof vi.fn>;
    updateVariables: ReturnType<typeof vi.fn>;
  };
  let transformer: StyleTransformer;
  let mockGenerate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerate = vi.fn();
    mockAiProvider = {
      name: AiProviderName.OPENAI,
      modelId: 'test-model',
      generate: mockGenerate,
    };

    mockCssParser = {
      extractVariables: vi.fn(),
      updateVariables: vi.fn(),
    };

    MockCssParser.mockImplementation(() => mockCssParser as CssParser);

    transformer = new StyleTransformer({ aiProvider: mockAiProvider });
  });

  describe('StyleTransformer', () => {
    describe('constructor', () => {
      it('should create transformer with AI provider and CSS parser', () => {
        expect(transformer.aiProvider).toBe(mockAiProvider);
        expect(MockCssParser).toHaveBeenCalledOnce();
      });
    });

    describe('transform', () => {
      const originalCss = ':root { --color: blue; }';
      const mockVariables: CssVariable[] = [
        { name: '--color', value: 'blue' },
        { name: '--bg', value: 'white' },
      ];

      const mockAiResponse = {
        variables: [
          { name: '--color', value: 'red' },
          { name: '--bg', value: 'black' },
        ],
        description: 'Updated to dark theme',
      };

      beforeEach(() => {
        mockCssParser.extractVariables.mockReturnValue(mockVariables);
        mockCssParser.updateVariables.mockReturnValue(':root { --color: red; --bg: black; }');
        mockGenerate.mockResolvedValue(mockAiResponse);
      });

      it('should transform CSS successfully with default style prompt', async () => {
        const result = await transformer.transform({
          originalCss,
        });

        expect(mockCssParser.extractVariables).toHaveBeenCalledWith(originalCss);
        expect(mockGenerate).toHaveBeenCalledWith(
          expect.stringContaining('Transform these CSS variables'),
        );
        expect(mockCssParser.updateVariables).toHaveBeenCalledWith(
          originalCss,
          mockAiResponse.variables,
        );
        expect(result).toEqual({
          transformedCss: ':root { --color: red; --bg: black; }',
          description: 'Updated to dark theme',
        });
      });

      it('should transform CSS with custom style prompt', async () => {
        const customPrompt = 'Make it colorful and bright';

        await transformer.transform({
          originalCss,
          stylePrompt: customPrompt,
        });

        expect(mockGenerate).toHaveBeenCalledWith(
          expect.stringContaining(customPrompt),
        );
      });

      it('should return original CSS when no variables are found', async () => {
        mockCssParser.extractVariables.mockReturnValue([]);

        const result = await transformer.transform({
          originalCss,
        });

        expect(result).toEqual({
          transformedCss: originalCss,
          description: '',
        });
        expect(mockGenerate).not.toHaveBeenCalled();
      });

      it('should handle AI provider errors gracefully', async () => {
        mockGenerate.mockRejectedValue(new Error('AI service unavailable'));

        const result = await transformer.transform({
          originalCss,
        });

        expect(result).toEqual({
          transformedCss: originalCss,
          description: '',
        });
      });

      it('should handle CSS parser errors gracefully', async () => {
        mockCssParser.extractVariables.mockImplementation(() => {
          throw new Error('CSS parsing failed');
        });

        const result = await transformer.transform({
          originalCss,
        });

        expect(result).toEqual({
          transformedCss: originalCss,
          description: '',
        });
      });

      it('should create correct prompt with variables and style description', async () => {
        const stylePrompt = 'dark mode theme';

        await transformer.transform({
          originalCss,
          stylePrompt,
        });

        const generatedPrompt = mockGenerate.mock.calls[0][0] as string;

        expect(generatedPrompt).toContain('Transform these CSS variables');
        expect(generatedPrompt).toContain(stylePrompt);
        expect(generatedPrompt).toContain('--color: blue');
        expect(generatedPrompt).toContain('--bg: white');
        expect(generatedPrompt).toContain('Return JSON');
      });
    });
  });

  describe('createStyleTransformer', () => {
    it('should create and return StyleTransformer instance', () => {
      const transformer = createStyleTransformer({
        aiProvider: mockAiProvider,
      });

      expect(transformer).toBeInstanceOf(StyleTransformer);
      expect(transformer.aiProvider).toBe(mockAiProvider);
    });
  });
});
