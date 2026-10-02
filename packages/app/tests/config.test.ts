import { describe, expect, it } from 'vitest';
import { loadAppConfig, loadWorkerConfig } from '../src/config.js';

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

describe('maintenance stage config', () => {
  it('defaults to normal for self-hosting and accepts the rollout stages', () => {
    expect(loadWorkerConfig(baseEnv).maintenanceStage).toBe('normal');
    expect(loadWorkerConfig({ ...baseEnv, VIBELOG_MAINTENANCE_STAGE: 'draining' }).maintenanceStage).toBe('draining');
    expect(loadWorkerConfig({ ...baseEnv, VIBELOG_MAINTENANCE_STAGE: 'locked' }).maintenanceStage).toBe('locked');
  });
  it('rejects unknown stages', () => {
    expect(() => loadWorkerConfig({ ...baseEnv, VIBELOG_MAINTENANCE_STAGE: 'open' })).toThrow('VIBELOG_MAINTENANCE_STAGE');
  });
});

describe('pinned agent CLI version', () => {
  const env = { ...baseEnv, BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters', EMAIL_PROVIDER: 'mailpit', MAILPIT_API_URL: 'http://localhost:8025', EMAIL_FROM: 'login@example.com' };
  it.each(['0.1.0', '1.0.0', '10.20.30'])('accepts stable version %s', (version) => {
    expect(loadAppConfig({ ...env, VIBELOG_AGENT_CLI_VERSION: version }).agentCliVersion).toBe(version);
  });
  it.each(['01.2.3', '1.02.3', '1.2.03', '1.2.3-beta', 'latest'])('rejects invalid stable version %s', (version) => {
    expect(() => loadAppConfig({ ...env, VIBELOG_AGENT_CLI_VERSION: version })).toThrow('pinned stable version');
  });
});
