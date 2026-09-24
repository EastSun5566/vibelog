import { validateBlogDesignSpecV2, type BlogDesignSpecV2 } from './schema-v2.js';

function normalizeNode<T extends { presentation?: object }>(node: T): T {
  if (node.presentation && Object.keys(node.presentation).length === 0) delete node.presentation;
  return node;
}

export function normalizeDesignV2(input: BlogDesignSpecV2): BlogDesignSpecV2 {
  const value = validateBlogDesignSpecV2(input);
  for (const color of Object.keys(value.theme.colors) as (keyof typeof value.theme.colors)[]) {
    value.theme.colors[color] = value.theme.colors[color].toLowerCase();
  }
  normalizeNode(value.chrome.header);
  normalizeNode(value.chrome.footer);
  normalizeNode(value.pages.home);
  value.pages.home.sections = Object.fromEntries(Object.entries(value.pages.home.sections)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, section]) => [id, normalizeNode(section)]));
  normalizeNode(value.pages.index);
  normalizeNode(value.pages.index.item);
  normalizeNode(value.pages.article);
  normalizeNode(value.pages.article.header);
  normalizeNode(value.pages.article.prose);
  value.pages.article.modules = Object.fromEntries(Object.entries(value.pages.article.modules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, module]) => [id, normalizeNode(module)]));
  return value;
}
