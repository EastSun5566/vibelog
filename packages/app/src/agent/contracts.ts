import { createHash } from 'node:crypto';
import { blogDesignSpecV2Schema, normalizeDesignV2 } from '@vibelog/core';
import type { BlogRecord } from '../database.js';

export const AGENT_API = '/api/agent/v1';
export const AGENT_TOKEN_SECONDS = 12 * 60 * 60;
export const PAIRING_SECONDS = 10 * 60;
export const AGENT_PERMISSION = 'draft:read-write';

export type AgentNextAction =
  | { action: 'connect'; reason?: 'initial_sync_recovery' }
  | { action: 'wait'; operationId: string }
  | { action: 'design' | 'identity' | 'selection' | 'sync' }
  | { action: 'open_editor'; reason?: 'deletion_in_progress' | 'draft_recovery_required' };

export function agentNextActions(blog: Pick<BlogRecord, 'state' | 'sourceArtifactId' | 'draftArtifactId'> | null, operationId: string | null): AgentNextAction[] {
  if (!blog) return [{ action: 'connect' }];
  if (blog.state === 'deleting') return [{ action: 'open_editor', reason: 'deletion_in_progress' }];
  if (operationId) return [{ action: 'wait', operationId }];
  if (!blog.sourceArtifactId && !blog.draftArtifactId) return [{ action: 'connect', reason: 'initial_sync_recovery' }];
  if (!blog.sourceArtifactId || !blog.draftArtifactId) return [{ action: 'open_editor', reason: 'draft_recovery_required' }];
  return [{ action: 'design' }, { action: 'identity' }, { action: 'selection' }, { action: 'sync' }, { action: 'open_editor' }];
}

export function stateVersion(blog: BlogRecord): string {
  return createHash('sha256').update(JSON.stringify([blog.id, blog.sourceArtifactId, blog.draftArtifactId, blog.draftDesignRevisionId, blog.contentVersion, blog.state])).digest('base64url');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function requestHash(action: string, body: unknown): string {
  return createHash('sha256').update(JSON.stringify([action, canonical(body)])).digest('hex');
}
export function validateAgentDesign(input: unknown) {
  const parsed = blogDesignSpecV2Schema.safeParse(input);
  return parsed.success
    ? { valid: true as const, design: normalizeDesignV2(parsed.data) }
    : { valid: false as const, errors: parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
}
