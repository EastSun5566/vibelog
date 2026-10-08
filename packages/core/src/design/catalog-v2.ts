export const DESIGN_V2_RULES = [
  'Choose only supported semantic components and variants. No HTML, CSS, JavaScript, URLs, routes, Markdown or article content.',
  'Use stable lowercase node IDs such as intro, featured, recent, topics, metadata, toc and navigation.',
  'Every section/module must appear exactly once in its page regions. References must exist.',
  'Homepage needs a posts section; post exclusions must reference posts sections and be acyclic.',
  'Grid columns must be 2 or 3; list columns must be absent or 1.',
  'An aside region requires with-aside article layout. Metadata belongs beforeBody; tags belong beforeBody or afterBody; author and navigation belong afterBody; TOC belongs beforeBody or aside; related-posts belongs aside or afterBody.',
  'Aside TOC goes in aside; inline TOC does not. Keep the Markdown body reserved for VibeLog.',
  'Text and link colors need 4.5:1 contrast against background.',
  'Presentation controls are normalized by VibeLog visual safeguards. Validate before submitting.',
];

export const DESIGN_CATALOG_V2_INSTRUCTIONS = `${DESIGN_V2_RULES.join(' ')} Use a clear hierarchy, balanced spacing and restrained decoration.`;
