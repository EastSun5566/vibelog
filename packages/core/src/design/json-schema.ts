import { z } from 'zod';

// Tools describe structure; cross-field refinements still run in the IR validator.
export function designJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: 'draft-07', io: 'input', reused: 'inline', cycles: 'throw' });
}
