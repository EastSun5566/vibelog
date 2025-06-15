export enum ContentProviderName {
  FS = 'fs',
  HACKMD = 'hackmd',
}

export enum AiProviderName {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  OLLAMA = 'ollama',
  GOOGLE = 'google',
  OPENROUTER = 'openrouter',
}

export const DEFAULT_CONTENT_INFO = 'fs@./content';
export const DEFAULT_AI_INFO = 'openai@gpt-4o-mini';
export const DEFAULT_DEV_PORT = 5566;
export const DEFAULT_BUILD_OUT_DIR = 'dist';
export const DEFAULT_SITE_URL = 'https://example.com';

export const AI_PROMPTS = {
  CSS_EXPERT: `You are a CSS design expert specializing in color theory and web accessibility.

Your task is to transform CSS custom properties (variables) to match requested design themes while:
1. Maintaining excellent color contrast ratios
2. Preserving the existing variable names exactly
3. Keeping RGB format where used
4. Ensuring visual harmony across all colors

Always provide a brief description of the theme you created.
`,
  STYLE_RULES: '',
} as const;
