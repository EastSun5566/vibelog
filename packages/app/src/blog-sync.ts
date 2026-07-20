import { z } from 'zod';

export const blogIdentitySchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
});

const excludedSlugsSchema = z.array(z.string().min(1)).optional();
const syncOperationPayloadSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('content'), excludedSlugs: excludedSlugsSchema }),
  z.object({ intent: z.literal('identity'), site: blogIdentitySchema, excludedSlugs: excludedSlugsSchema }),
  z.object({ intent: z.literal('selection'), excludedSlugs: z.array(z.string().min(1)) }),
]);

export type BlogIdentity = z.infer<typeof blogIdentitySchema>;
export type SyncOperationIntent = 'content' | 'identity' | 'selection';

export function parseSyncOperationPayload(payload: Record<string, unknown>) {
  return Object.keys(payload).length === 0
    ? { intent: 'content' as const }
    : syncOperationPayloadSchema.parse(payload);
}

export function syncOperationIntent(payload: Record<string, unknown>): SyncOperationIntent {
  if (payload.intent === 'identity' || payload.intent === 'selection') return payload.intent;
  return 'content';
}
