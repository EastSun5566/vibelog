import type { Paragraph, PhrasingContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';

const DESCRIPTION_LIMIT = 160;
const HTML_TAG = /<\/?[a-z][^>\n]*>/giu;
const HTML_BLOCK = /^<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*<\/\1\s*>$/iu;
const HTML_COMMENT = /^<!--[\s\S]*-->$/u;
const HTML_SINGLE_TAG = /^<[a-z][\w-]*(?:\s[^>]*)?\/?\s*>$/iu;

function inlineText(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
      return node.value.replace(HTML_TAG, ' ');
    case 'inlineCode':
      return node.value;
    case 'break':
      return ' ';
    case 'emphasis':
    case 'strong':
    case 'linkReference':
      return node.children.map(inlineText).join('');
    case 'link': {
      const label = node.children.map(inlineText).join('');
      return label.trim() === node.url.trim() ? '' : label;
    }
    default:
      return '';
  }
}

function paragraphText(paragraph: Paragraph): string {
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'text') {
    const value = paragraph.children[0].value.trim();
    if (HTML_BLOCK.test(value) || HTML_COMMENT.test(value) || HTML_SINGLE_TAG.test(value)) return '';
  }
  return paragraph.children.map(inlineText).join('').replace(/\s+/gu, ' ').trim();
}

function truncateDescription(value: string): string {
  const codePoints = Array.from(value);
  return codePoints.length <= DESCRIPTION_LIMIT
    ? value
    : `${codePoints.slice(0, DESCRIPTION_LIMIT - 1).join('')}…`;
}

export function extractPostDescription(markdown: string, fallbackTitle: string): string {
  try {
    const tree = fromMarkdown(markdown);
    for (const node of tree.children) {
      if (node.type !== 'paragraph') continue;
      const description = paragraphText(node);
      if (description) return truncateDescription(description);
    }
  } catch {
    // A malformed source must not prevent the remaining content from syncing.
  }
  return truncateDescription(fallbackTitle.replace(/\s+/gu, ' ').trim());
}
