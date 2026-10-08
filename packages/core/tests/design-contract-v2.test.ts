import { validateToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { designToolV2, refineDesignToolV2 } from '../src/adapters/ai/tool-v2.js';
import { DESIGN_CATALOG_V2_INSTRUCTIONS, DESIGN_V2_RULES } from '../src/design/catalog-v2.js';
import { designContractV2 } from '../src/design/contract-v2.js';
import { DEFAULT_DESIGN_V2 } from '../src/design/defaults-v2.js';
import { designPatchesV2Schema } from '../src/design/patch-schema-v2.js';
import { blogDesignSpecV2Schema, type BlogDesignSpecV2 } from '../src/design/schema-v2.js';

function proposal(update?: (design: BlogDesignSpecV2) => void) {
  const design = structuredClone(DEFAULT_DESIGN_V2);
  update?.(design);
  return design;
}
function home(count: number) {
  return proposal((design) => {
    const ids = Array.from({ length: count }, (_, index) => `posts-${String(index)}`);
    design.pages.home.sections = Object.fromEntries(ids.map((id) => [id, { type: 'posts', variant: 'list', source: { strategy: 'latest' }, limit: 5 }]));
    design.pages.home.regions.main = ids;
  });
}
function checkTool(arguments_: unknown): unknown {
  return validateToolCall([designToolV2], { type: 'toolCall', id: 'test', name: designToolV2.name, arguments: arguments_ as BlogDesignSpecV2 });
}

describe('shared IR v2 structural contract', () => {
  it('uses the same schema for the AI tool and serialized agent contract', () => {
    const contract = designContractV2();
    expect(contract.schema).toBe(designToolV2.parameters);
    expect(contract.schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(JSON.stringify(contract.schema)).not.toContain('"$ref"');
    expect(JSON.stringify(contract.schema)).not.toContain('"$defs"');
    expect(contract.rules).toEqual(expect.arrayContaining(DESIGN_V2_RULES));
    for (const rule of DESIGN_V2_RULES) expect(DESIGN_CATALOG_V2_INSTRUCTIONS).toContain(rule);
    expect(DESIGN_CATALOG_V2_INSTRUCTIONS).not.toContain('stateVersion');
    const input = JSON.stringify(DEFAULT_DESIGN_V2);
    expect(checkTool(contract.example)).toEqual(contract.example);
    expect(JSON.stringify(DEFAULT_DESIGN_V2)).toBe(input);
  });

  it.each([
    ['default', proposal()],
    ['uppercase HEX', proposal((design) => { design.theme.colors.surface = '#F7F7F5'; })],
    ['optional presentation', proposal((design) => { design.pages.home.presentation = { spacing: 'spacious' }; })],
    ['sidebar homepage', proposal((design) => {
      design.pages.home = { ...design.pages.home, layout: 'sidebar', regions: { main: ['recent'], aside: ['intro'] } };
    })],
    ['magazine homepage', proposal((design) => {
      design.pages.home = { ...design.pages.home, layout: 'magazine', regions: { lead: ['intro'], main: ['recent'], rail: [] } };
    })],
    ['one homepage section', home(1)],
    ['eight homepage sections', home(8)],
    ['nine article modules', proposal((design) => {
      const ids = Array.from({ length: 9 }, (_, index) => `metadata-${String(index)}`);
      design.pages.article.modules = Object.fromEntries(ids.map((id) => [id, { type: 'metadata', variant: 'compact' }]));
      design.pages.article.regions = { beforeBody: ids, aside: [], afterBody: [] };
    })],
  ])('accepts %s in runtime and tool validation', (_name, input) => {
    expect(blogDesignSpecV2Schema.safeParse(input).success).toBe(true);
    expect(checkTool(input)).toEqual(input);
  });

  it.each([
    ['wrong version', { ...DEFAULT_DESIGN_V2, version: 3 }],
    ['missing required field', proposal((design) => { Reflect.deleteProperty(design.theme, 'motif'); })],
    ['unsupported variant', proposal((design) => { Reflect.set(design.pages.article.header, 'variant', 'invented'); })],
    ['unknown nested property', proposal((design) => { Reflect.set(design.theme.colors, 'css', 'private-invalid-value'); })],
    ['invalid HEX', proposal((design) => { design.theme.colors.surface = '#fff'; })],
    ['zero homepage sections', home(0)],
    ['nine homepage sections', home(9)],
  ])('rejects %s in runtime and tool validation', (_name, input) => {
    expect(blogDesignSpecV2Schema.safeParse(input).success).toBe(false);
    expect(() => { checkTool(input); }).toThrow();
  });

  it.each([
    ['blank description', proposal((design) => { design.description = '   '; })],
    ['reserved ID', proposal((design) => {
      design.pages.article.modules = Object.fromEntries([['constructor', { type: 'metadata', variant: 'compact' } as const]]);
      design.pages.article.regions = { beforeBody: ['constructor'], aside: [], afterBody: [] };
    })],
    ['unknown reference', proposal((design) => { design.pages.home.regions.main[0] = 'missing'; })],
    ['duplicate placement', proposal((design) => { design.pages.home.regions.main.push('intro'); })],
    ['exclusion cycle', proposal((design) => {
      design.pages.home.sections.recent = { type: 'posts', variant: 'list', source: { strategy: 'latest' }, limit: 5, exclude: { sections: ['recent'] } };
    })],
    ['module placement', proposal((design) => {
      design.pages.article.regions.beforeBody.push('navigation');
      design.pages.article.regions.afterBody = [];
    })],
    ['low contrast', proposal((design) => { design.theme.colors.text = design.theme.colors.background; })],
  ])('keeps %s enforced by runtime refinements', (_name, input) => {
    expect(() => { checkTool(input); }).not.toThrow();
    expect(blogDesignSpecV2Schema.safeParse(input).success).toBe(false);
  });

  it.each([
    [{ op: 'add', path: '/pages/home/presentation', value: { spacing: 'spacious' } }],
    [{ op: 'replace', path: '/description', value: 'Updated' }],
    [{ op: 'remove', path: '/pages/home/presentation' }],
    [{ op: 'move', from: '/pages/home/regions/main/0', path: '/pages/home/regions/main/1' }],
  ].map((patches) => ({ patches })))('shares patch structure for operation %#', ({ patches }) => {
    expect(designPatchesV2Schema.safeParse(patches).success).toBe(true);
    expect(validateToolCall([refineDesignToolV2], { type: 'toolCall', id: 'patch', name: refineDesignToolV2.name, arguments: { patches } })).toEqual({ patches });
  });

  it.each([
    [],
    Array.from({ length: 17 }, () => ({ op: 'remove', path: '/description' })),
    [{ op: 'replace', path: '/description' }],
    [{ op: 'move', path: '/description' }],
    [{ op: 'remove', path: '/description', value: 'extra' }],
    [{ op: 'copy', from: '/description', path: '/description' }],
  ].map((patches) => ({ patches })))('rejects malformed patch structure %# in both validators', ({ patches }) => {
    expect(designPatchesV2Schema.safeParse(patches).success).toBe(false);
    expect(() => { validateToolCall([refineDesignToolV2], { type: 'toolCall', id: 'patch', name: refineDesignToolV2.name, arguments: { patches } }); }).toThrow();
  });
});
