import { normalizeDesignV2 } from './normalize-v2.js';
import { validateBlogDesignSpecV2, type BlogDesignSpecV2 } from './schema-v2.js';

const MAX_PATCHES = 16;
const MAX_PATCH_BYTES = 32 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ROOT_KEYS = new Set(['theme', 'chrome', 'pages', 'description']);
const HOME_REGIONS = new Set(['main', 'aside', 'lead', 'rail']);

type Patch =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string };

function pointer(input: string): string[] {
  if (!input.startsWith('/')) throw new Error('Patch path must be a JSON pointer');
  const segments = input.slice(1).split('/').map((segment) => {
    if (/~(?![01])/u.test(segment)) throw new Error('Patch path has an invalid escape');
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (FORBIDDEN_KEYS.has(key)) throw new Error('Patch path contains a reserved key');
    return key;
  });
  if (!ROOT_KEYS.has(segments[0] ?? '') || (segments[0] !== 'description' && segments.length < 2) || (segments[0] === 'description' && segments.length !== 1)) {
    throw new Error('Patch path is outside editable design fields');
  }
  return segments;
}

function assertSafeValue(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('Patch value contains a reserved key');
    assertSafeValue(child);
  }
}

function arrayIndex(key: string, length: number, allowEnd: boolean): number {
  if (key === '-' && allowEnd) return length;
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) throw new Error('Patch array index is invalid');
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index > length || (!allowEnd && index === length)) throw new Error('Patch array index is out of bounds');
  return index;
}

function parentAt(document: unknown, segments: string[]): { parent: Record<string, unknown> | unknown[]; key: string } {
  let current: unknown = document;
  for (const key of segments.slice(0, -1)) {
    if (!current || typeof current !== 'object') throw new Error('Patch parent does not exist');
    if (Array.isArray(current)) current = current[arrayIndex(key, current.length, false)];
    else {
      if (!Object.hasOwn(current, key)) throw new Error('Patch parent does not exist');
      current = (current as Record<string, unknown>)[key];
    }
  }
  if (!current || typeof current !== 'object') throw new Error('Patch parent does not exist');
  return { parent: current as Record<string, unknown> | unknown[], key: segments.at(-1) ?? '' };
}

function mutate(document: unknown, segments: string[], operation: 'add' | 'replace' | 'remove', value?: unknown): unknown {
  const { parent, key } = parentAt(document, segments);
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, operation === 'add');
    if (operation === 'add') parent.splice(index, 0, value);
    else if (operation === 'replace') parent[index] = value;
    else return parent.splice(index, 1)[0];
    return undefined;
  }
  const exists = Object.hasOwn(parent, key);
  if (operation !== 'add' && !exists) throw new Error('Patch target does not exist');
  if (operation === 'remove') {
    const removed = parent[key];
    Reflect.deleteProperty(parent, key);
    return removed;
  }
  parent[key] = value;
  return undefined;
}

function isHomeRegionIndex(segments: string[]): boolean {
  return segments.length === 5 && segments[0] === 'pages' && segments[1] === 'home' && segments[2] === 'regions' && HOME_REGIONS.has(segments[3] ?? '');
}

function parsePatches(input: unknown): Patch[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_PATCHES) throw new Error('Design patch must contain 1–16 operations');
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(input)); }
  catch { throw new Error('Design patch is not JSON'); }
  if (bytes > MAX_PATCH_BYTES) throw new Error('Design patch exceeds 32 KiB');
  return input.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid patch operation ${String(index + 1)}`);
    const patch = item as Record<string, unknown>;
    if (typeof patch.path !== 'string') throw new Error(`Invalid patch path at operation ${String(index + 1)}`);
    if (patch.op === 'move') {
      if (typeof patch.from !== 'string' || Object.keys(patch).some((key) => !['op', 'path', 'from'].includes(key))) throw new Error(`Invalid move operation ${String(index + 1)}`);
      if (!isHomeRegionIndex(pointer(patch.from)) || !isHomeRegionIndex(pointer(patch.path))) throw new Error('Move is limited to homepage region entries');
    } else if (patch.op === 'add' || patch.op === 'replace') {
      if (!Object.hasOwn(patch, 'value') || Object.keys(patch).some((key) => !['op', 'path', 'value'].includes(key))) throw new Error(`Invalid patch operation ${String(index + 1)}`);
      assertSafeValue(patch.value);
    } else if (patch.op !== 'remove' || Object.keys(patch).some((key) => !['op', 'path'].includes(key))) {
      throw new Error(`Invalid patch operation ${String(index + 1)}`);
    }
    pointer(patch.path);
    return patch as Patch;
  });
}

export function applyDesignPatchV2(base: BlogDesignSpecV2, input: unknown): BlogDesignSpecV2 {
  const patches = parsePatches(input);
  const candidate: unknown = validateBlogDesignSpecV2(base);
  for (const patch of patches) {
    const path = pointer(patch.path);
    if (patch.op === 'move') {
      const from = pointer(patch.from);
      const moved = mutate(candidate, from, 'remove');
      mutate(candidate, path, 'add', moved);
    } else {
      mutate(candidate, path, patch.op, patch.op === 'remove' ? undefined : structuredClone(patch.value));
    }
  }
  return normalizeDesignV2(validateBlogDesignSpecV2(candidate));
}
