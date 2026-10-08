import type { Tool } from '@earendil-works/pi-ai';
import { designJsonSchema } from '../../design/json-schema.js';
import { refineDesignV2Schema } from '../../design/patch-schema-v2.js';
import { blogDesignSpecV2Schema } from '../../design/schema-v2.js';

export const designToolV2 = {
  name: 'propose_design',
  description: 'Propose one complete VibeLog Presentation IR version 2 design using supported semantic components.',
  parameters: designJsonSchema(blogDesignSpecV2Schema),
} satisfies Tool;

export const refineDesignToolV2 = {
  name: 'refine_design',
  description: 'Make a focused edit to the saved version 2 design. Return only the fields that need to change as bounded JSON Patch operations. Use move only to reorder existing homepage sections in regions.',
  parameters: designJsonSchema(refineDesignV2Schema),
} satisfies Tool;
