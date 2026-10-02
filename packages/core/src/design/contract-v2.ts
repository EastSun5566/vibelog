import { designToolV2 } from '../adapters/ai/tool-v2.js';
import { DEFAULT_DESIGN_V2 } from './defaults-v2.js';

export function designContractV2() {
  return {
    version: 2,
    schema: designToolV2.parameters,
    example: DEFAULT_DESIGN_V2,
    rules: [
      'Return a complete IR v2 design. No HTML, CSS, JavaScript, URLs or arbitrary components.',
      'Every section/module must appear exactly once in its page regions. References must exist.',
      'Homepage needs a posts section; post exclusions must reference posts sections and be acyclic.',
      'Grid columns must be 2 or 3; list columns must be absent or 1.',
      'An aside region requires with-aside article layout. Metadata belongs beforeBody; tags belong beforeBody or afterBody; author and navigation belong afterBody; TOC belongs beforeBody or aside; related-posts belongs aside or afterBody.',
      'Aside TOC goes in aside; inline TOC does not. Each article module ID must occur exactly once.',
      'Text and link colors need 4.5:1 contrast against background.',
      'Presentation controls are normalized by VibeLog visual safeguards. Validate before submitting.',
      'Use the stateVersion from design context; refresh and reconsider your changes after a conflict.',
    ],
  };
}
