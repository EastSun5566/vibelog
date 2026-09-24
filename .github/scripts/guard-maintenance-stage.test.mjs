import { expect, test } from 'vitest';
import { checkMaintenanceTransition } from './guard-maintenance-stage.mjs';

test('only allows intentional maintenance transitions', () => {
  for (const [current, desired, options] of [
    ['', 'normal', {}], ['normal', 'normal', {}], ['normal', 'draining', {}],
    ['draining', 'locked', { confirmDrained: true }], ['locked', 'locked', {}],
    ['locked', 'normal', { confirmResume: true }],
  ]) expect(() => checkMaintenanceTransition(current, desired, options)).not.toThrow();
  for (const [current, desired, options] of [
    ['', 'locked', {}], ['normal', 'locked', {}], ['draining', 'normal', {}],
    ['draining', 'locked', {}], ['locked', 'normal', {}], ['other', 'normal', {}],
    ['normal', 'other', {}],
  ]) expect(() => checkMaintenanceTransition(current, desired, options)).toThrow();
});
