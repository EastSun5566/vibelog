import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';

const baseEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://unused',
  OBJECT_STORE_ENDPOINT: 'https://unused.example.com',
  OBJECT_STORE_BUCKET: 'unused',
  OBJECT_STORE_ACCESS_KEY_ID: 'unused',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
  VIBELOG_AI_PROVIDER: 'opencode-go',
  VIBELOG_AI_MODEL: 'qwen3.8-flash',
};

describe('AI fallback config', () => {
  it('loads an optional JSON model list', () => {
    expect(loadWorkerConfig({ ...baseEnv, VIBELOG_AI_FALLBACK_MODELS: '["glm-5.3-flash"]' }).aiFallbackModels).toEqual(['glm-5.3-flash']);
    expect(loadWorkerConfig(baseEnv).aiFallbackModels).toEqual([]);
  });

  it.each([
    ['not-json', 'JSON array'],
    ['{}', 'JSON array'],
    ['[""]', 'non-empty'],
    ['["glm-5.3-flash","glm-5.3-flash"]', 'duplicate'],
    ['["qwen3.8-flash"]', 'must not repeat'],
  ])('rejects invalid fallback config %s', (value, message) => {
    expect(() => loadWorkerConfig({ ...baseEnv, VIBELOG_AI_FALLBACK_MODELS: value })).toThrow(message);
  });
});
