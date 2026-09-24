import type { BlogDesignSpecV2 } from './schema-v2.js';
import { normalizeDesignV2 } from './normalize-v2.js';

export type DesignImpact = 'none' | 'presentation' | 'structure';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function structural(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structural);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, child]) => key !== 'theme' && key !== 'presentation' && key !== 'description' && child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, structural(child)]));
  }
  return value;
}

export function analyzeDesignImpact(previous: BlogDesignSpecV2, next: BlogDesignSpecV2): DesignImpact {
  const before = normalizeDesignV2(previous);
  const after = normalizeDesignV2(next);
  if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) return 'none';
  if (JSON.stringify(structural(before)) === JSON.stringify(structural(after))) return 'presentation';
  return 'structure';
}
