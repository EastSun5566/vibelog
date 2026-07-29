import { z } from 'zod';

export const blogLanguageSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export const blogIdentitySchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  language: blogLanguageSchema,
});

const excludedSlugsSchema = z.array(z.string().min(1)).optional();
const persistedBlogIdentitySchema = blogIdentitySchema.extend({ language: blogLanguageSchema.default('zh-Hant') });
const syncOperationPayloadSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('content'), excludedSlugs: excludedSlugsSchema }),
  z.object({ intent: z.literal('identity'), site: persistedBlogIdentitySchema, excludedSlugs: excludedSlugsSchema }),
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
