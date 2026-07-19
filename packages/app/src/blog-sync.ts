import { z } from 'zod';

export const blogIdentitySchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
});

const syncOperationPayloadSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('content') }),
  z.object({ intent: z.literal('identity'), site: blogIdentitySchema }),
]);

export type BlogIdentity = z.infer<typeof blogIdentitySchema>;
export type SyncOperationIntent = 'content' | 'identity';

export function parseSyncOperationPayload(payload: Record<string, unknown>) {
  return Object.keys(payload).length === 0
    ? { intent: 'content' as const }
    : syncOperationPayloadSchema.parse(payload);
}

export function syncOperationIntent(payload: Record<string, unknown>): SyncOperationIntent {
  return payload.intent === 'identity' ? 'identity' : 'content';
}
