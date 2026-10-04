import { fromMarkdown } from 'mdast-util-from-markdown';
import type { PhrasingContent, Root, RootContent } from 'mdast';

const DANGEROUS_SCHEME = /\]\(\s*(?:javascript|vbscript|data):/gi;

export function isDangerousMarkdownUrl(url: string): boolean {
  // Normalize spacing and control characters before checking blocked schemes.
  // oxlint-disable-next-line no-control-regex
  return /^(?:javascript|vbscript|data):/iu.test(url.replace(/[\u0000-\u0020\u007f-\u009f]/gu, ''));
}

export function sanitizeMarkdown(markdown: string): string {
  const source = markdown.replaceAll('\0', '');
  if (!source.includes('<') && !source.includes('](')) return source;
  const protectedRanges: { start: number; end: number }[] = [];
  const edits: { start: number; end: number; value: string }[] = [];
  function visit(node: Root | RootContent | PhrasingContent): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html') protectedRanges.push({ start, end });
      if (node.type === 'html') edits.push({ start, end, value: source.slice(start, end).replaceAll('<', '&lt;') });
    }
    if ('children' in node) for (const child of node.children) visit(child);
  }
  visit(fromMarkdown(source));
  let rangeIndex = 0;
  for (const match of source.matchAll(DANGEROUS_SCHEME)) {
    const start = match.index;
    let range = protectedRanges[rangeIndex];
    while (range && range.end <= start) range = protectedRanges[++rangeIndex];
    if (range && start >= range.start && start < range.end) continue;
    edits.push({ start, end: start + match[0].length, value: '](about:blank#blocked-' });
  }
  const parts: string[] = [];
  let offset = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    parts.push(source.slice(offset, edit.start), edit.value);
    offset = edit.end;
  }
  parts.push(source.slice(offset));
  return parts.join('');
}
