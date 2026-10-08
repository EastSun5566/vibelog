import { designToolV2 } from '../adapters/ai/tool-v2.js';
import { DESIGN_V2_RULES } from './catalog-v2.js';
import { DEFAULT_DESIGN_V2 } from './defaults-v2.js';

export function designContractV2() {
  return {
    version: 2,
    schema: designToolV2.parameters,
    example: DEFAULT_DESIGN_V2,
    rules: [
      'Return a complete IR v2 design.',
      ...DESIGN_V2_RULES,
      'Use the stateVersion from design context; refresh and reconsider your changes after a conflict.',
    ],
  };
}
