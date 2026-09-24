import { Type, type Tool } from '@earendil-works/pi-ai';

const enumType = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,47}$' });
const presentation = Type.Object({
  emphasis: Type.Optional(enumType(['subtle', 'normal', 'strong'])),
  width: Type.Optional(enumType(['reading', 'content', 'full'])),
  align: Type.Optional(enumType(['start', 'center'])),
  surface: Type.Optional(enumType(['plain', 'soft', 'prominent'])),
  density: Type.Optional(enumType(['compact', 'comfortable', 'relaxed'])),
  spacing: Type.Optional(enumType(['none', 'tight', 'normal', 'relaxed', 'spacious'])),
  frame: Type.Optional(enumType(['none', 'subtle', 'strong'])),
}, { additionalProperties: false });
const withPresentation = { presentation: Type.Optional(presentation) };
const nodeIds = Type.Array(id, { maxItems: 8 });
const postSource = Type.Union([
  Type.Object({ strategy: Type.Literal('latest') }, { additionalProperties: false }),
  Type.Object({ strategy: Type.Literal('recently-updated') }, { additionalProperties: false }),
]);
const homeSection = Type.Union([
  Type.Object({ type: Type.Literal('intro'), variant: enumType(['minimal', 'centered', 'split']), showAuthor: Type.Boolean(), ...withPresentation }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('posts'), source: postSource,
    variant: enumType(['hero', 'split', 'list', 'cards', 'grid']),
    limit: Type.Union([1, 2, 3, 5, 6, 9].map((value) => Type.Literal(value))),
    columns: Type.Optional(Type.Union([1, 2, 3].map((value) => Type.Literal(value)))),
    exclude: Type.Optional(Type.Object({ sections: Type.Array(id, { minItems: 1, maxItems: 7 }) }, { additionalProperties: false })),
    ...withPresentation,
  }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('topics'), variant: enumType(['list', 'cloud']), limit: Type.Union([6, 12, 24].map((value) => Type.Literal(value))), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('author'), variant: enumType(['compact', 'profile']), ...withPresentation }, { additionalProperties: false }),
]);
const sections = Type.Record(id, homeSection, { minProperties: 1, maxProperties: 8 });
const home = Type.Union([
  Type.Object({ layout: Type.Literal('stack'), sections, regions: Type.Object({ main: nodeIds }, { additionalProperties: false }), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ layout: Type.Literal('sidebar'), sections, regions: Type.Object({ main: nodeIds, aside: nodeIds }, { additionalProperties: false }), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ layout: Type.Literal('magazine'), sections, regions: Type.Object({ lead: nodeIds, main: nodeIds, rail: nodeIds }, { additionalProperties: false }), ...withPresentation }, { additionalProperties: false }),
]);
const articleModule = Type.Union([
  Type.Object({ type: Type.Literal('metadata'), variant: enumType(['compact', 'detailed']), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('toc'), variant: enumType(['inline', 'aside']), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('tags'), variant: Type.Literal('list'), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('author'), variant: enumType(['compact', 'profile']), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('related-posts'), variant: enumType(['list', 'cards']), limit: Type.Union([2, 3, 5].map((value) => Type.Literal(value))), ...withPresentation }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('navigation'), variant: enumType(['links', 'cards']), ...withPresentation }, { additionalProperties: false }),
]);

export const designToolV2: Tool = {
  name: 'propose_design',
  description: 'Propose one complete VibeLog Presentation IR version 2 design using supported semantic components.',
  parameters: Type.Object({
    version: Type.Literal(2),
    theme: Type.Object({
      motif: enumType(['minimal', 'editorial', 'notebook']), appearance: enumType(['light', 'dark']),
      colors: Type.Object({ background: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), surface: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), text: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), muted: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), accent: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), border: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }) }, { additionalProperties: false }),
      typography: Type.Object({ bodyFont: enumType(['system-sans', 'system-serif', 'system-mono']), headingFont: enumType(['system-sans', 'system-serif', 'system-mono']), scale: enumType(['compact', 'comfortable', 'large']) }, { additionalProperties: false }),
      layout: Type.Object({ contentWidth: enumType(['narrow', 'medium', 'wide']), density: enumType(['compact', 'comfortable']), radius: enumType(['none', 'soft', 'round']) }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    chrome: Type.Object({
      header: Type.Object({ variant: enumType(['compact', 'centered', 'masthead']), ...withPresentation }, { additionalProperties: false }),
      footer: Type.Object({ variant: enumType(['minimal', 'profile']), ...withPresentation }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    pages: Type.Object({
      home,
      index: Type.Object({
        layout: enumType(['list', 'grid', 'magazine']),
        item: Type.Object({ variant: enumType(['divided', 'cards', 'numbered']), showDescription: Type.Boolean(), showTags: Type.Boolean(), ...withPresentation }, { additionalProperties: false }),
        columns: Type.Optional(Type.Union([1, 2, 3].map((value) => Type.Literal(value)))),
        ...withPresentation,
      }, { additionalProperties: false }),
      article: Type.Object({
        layout: enumType(['reading', 'wide', 'with-aside']),
        header: Type.Object({ variant: enumType(['simple', 'editorial']), ...withPresentation }, { additionalProperties: false }),
        modules: Type.Record(id, articleModule, { maxProperties: 8 }),
        regions: Type.Object({ beforeBody: nodeIds, aside: nodeIds, afterBody: nodeIds }, { additionalProperties: false }),
        prose: Type.Object({ codeBlock: enumType(['plain', 'panel']), ...withPresentation }, { additionalProperties: false }),
        ...withPresentation,
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    description: Type.String({ minLength: 1, maxLength: 240 }),
  }, { additionalProperties: false }),
};
