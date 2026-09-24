import { describe, expect, it } from 'vitest';
import { blocksRequest, maintenanceResponse } from '../src/maintenance.js';

describe('maintenance gate', () => {
  it.each([
    ['normal', 'web', '/', false], ['normal', 'worker', '/tasks/operations', false],
    ['draining', 'web', '/', true], ['draining', 'worker', '/tasks/operations', false],
    ['locked', 'web', '/editor', true], ['locked', 'worker', '/tasks/maintenance', true],
    ['locked', 'web', '/health', false], ['locked', 'worker', '/health', false],
  ] as const)('%s %s %s blocked=%s', (stage, service, path, blocked) => {
    expect(blocksRequest(stage, service, path)).toBe(blocked);
  });

  it('returns an uncached retryable response without a HEAD body', async () => {
    const response = maintenanceResponse('GET');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(await response.text()).toContain('maintenance');
    expect(await maintenanceResponse('HEAD').text()).toBe('');
  });
});
