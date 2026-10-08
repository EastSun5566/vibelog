import { z } from 'zod';

const patch = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z.object({ op: z.literal('move'), from: z.string(), path: z.string() }).strict(),
]);

export const designPatchesV2Schema = z.array(patch).min(1).max(16);
export const refineDesignV2Schema = z.object({ patches: designPatchesV2Schema }).strict();
