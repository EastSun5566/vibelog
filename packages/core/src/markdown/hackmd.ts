import type { Blockquote, Code, Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast';

type CompatibleNode = Root | RootContent | PhrasingContent;
type CompatibleParent = CompatibleNode & { children: CompatibleNode[] };
interface HastData {
  directiveLabel?: boolean | null;
  hackmdTitle?: string;
  hName?: string;
  hProperties?: Record<string, unknown>;
}

const CALLOUT_TITLES = {
  caution: 'Caution',
  danger: 'Danger',
  important: 'Important',
  info: 'Info',
  note: 'Note',
  success: 'Success',
  tip: 'Tip',
  warning: 'Warning',
} as const;

type CalloutType = keyof typeof CALLOUT_TITLES;

const GITHUB_ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\r\n]+))?(?:\r?\n|$)/iu;
const HACKMD_CALLOUTS = new Set<CalloutType>(['info', 'success', 'warning', 'danger']);

function hasChildren(node: CompatibleNode): node is CompatibleParent {
  return 'children' in node && Array.isArray(node.children);
}

function dataFor(node: CompatibleNode): HastData {
  const nodeWithData = node as CompatibleNode & { data?: HastData };
  nodeWithData.data ??= {};
  return nodeWithData.data;
}

function textFrom(children: PhrasingContent[]): string {
  return children.map((child) => {
    if ('value' in child && typeof child.value === 'string') return child.value;
    return hasChildren(child) ? textFrom(child.children as PhrasingContent[]) : '';
  }).join('').trim();
}

function titleParagraph(title: string, className: string, hName = 'p'): Paragraph {
  return {
    type: 'paragraph',
    data: {
      hName,
      hProperties: { className: [className] },
    } as Paragraph['data'],
    children: [{ type: 'text', value: title }],
  };
}

function directiveTitle(node: Extract<RootContent, { type: 'containerDirective' }>, fallback: string): string {
  const explicitTitle = (node.data as HastData | undefined)?.hackmdTitle?.trim();
  if (explicitTitle) return explicitTitle;
  const firstChild = node.children[0];
  if (firstChild?.type !== 'paragraph' || !(firstChild.data as HastData | undefined)?.directiveLabel) return fallback;
  node.children.shift();
  return textFrom(firstChild.children) || fallback;
}

function transformContainer(node: Extract<RootContent, { type: 'containerDirective' }>): boolean {
  const name = node.name.toLowerCase();
  if (name === 'spoiler') {
    const title = directiveTitle(node, 'Details');
    const data = dataFor(node);
    data.hName = 'details';
    data.hProperties = { className: ['spoiler'] };
    node.children.unshift(titleParagraph(title, 'spoiler-title', 'summary'));
    return true;
  }

  if (!HACKMD_CALLOUTS.has(name as CalloutType)) return false;
  const type = name as CalloutType;
  const title = directiveTitle(node, CALLOUT_TITLES[type]);
  const data = dataFor(node);
  data.hName = 'aside';
  data.hProperties = {
    ariaLabel: title,
    className: ['callout', `callout-${type}`],
  };
  node.children.unshift(titleParagraph(title, 'callout-title'));
  return true;
}

function transformAlert(node: Blockquote): void {
  const firstParagraph = node.children[0];
  if (firstParagraph?.type !== 'paragraph') return;
  const firstContent = firstParagraph.children[0];
  if (firstContent?.type !== 'text') return;
  const match = GITHUB_ALERT.exec(firstContent.value);
  if (!match?.[1]) return;

  const type = match[1].toLowerCase() as CalloutType;
  const title = match[2]?.trim() || CALLOUT_TITLES[type];
  firstContent.value = firstContent.value.slice(match[0].length).trimStart();
  if (!firstContent.value) firstParagraph.children.shift();
  if (firstParagraph.children.length === 0) node.children.shift();

  const data = dataFor(node);
  data.hName = 'aside';
  data.hProperties = {
    ariaLabel: title,
    className: ['callout', `callout-${type}`],
  };
  node.children.unshift(titleParagraph(title, 'callout-title'));
}

function normalizeCodeLanguage(node: Code): void {
  if (!node.lang) return;
  const match = /^([a-z][a-z0-9+#.-]*)(?:=(\d+|\+)?)$/iu.exec(node.lang);
  if (!match?.[1]) return;
  node.lang = match[1];
  if (match[2] && match[2] !== '+') node.meta = `${node.meta ?? ''} line-start=${match[2]}`.trim();
}

function textNode(value: string): Text {
  return { type: 'text', value };
}

function inlineElement(hName: string, children: PhrasingContent[]): PhrasingContent {
  return {
    type: 'emphasis',
    data: { hName } as PhrasingContent['data'],
    children,
  };
}

const INLINE_EXTENSION = /==([^=\n]+)==|\+\+([^+\n]+)\+\+|(?<!~)~([^~\n]+)~(?!~)|(?<!\^)\^([^^\n]+)\^(?!\^)|\{([^{}|\n]+)\|([^{}|\n]+)\}/gu;

function transformInlineText(node: Text, source: string): PhrasingContent[] {
  if (!/[=+~^{}|]/u.test(node.value)) return [node];
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  // Markdown escapes and entities change the source slice. Leaving the whole
  // node alone preserves the author's literal input rather than guessing.
  if (source && start !== undefined && end !== undefined && source.slice(start, end) !== node.value) return [node];

  const output: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(INLINE_EXTENSION)) {
    const index = match.index;
    const full = match[0];
    const content = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (index === undefined || !content || content.trim() !== content) continue;
    if (index > cursor) output.push(textNode(node.value.slice(cursor, index)));
    if (match[1]) output.push(inlineElement('mark', [textNode(content)]));
    else if (match[2]) output.push(inlineElement('ins', [textNode(content)]));
    else if (match[3]) output.push(inlineElement('sub', [textNode(content)]));
    else if (match[4]) output.push(inlineElement('sup', [textNode(content)]));
    else if (match[5] && match[6]) {
      output.push(inlineElement('ruby', [
        textNode(match[5]),
        inlineElement('rp', [textNode('(')]),
        inlineElement('rt', [textNode(match[6])]),
        inlineElement('rp', [textNode(')')]),
      ]));
    }
    cursor = index + full.length;
  }
  if (cursor === 0) return [node];
  if (cursor < node.value.length) output.push(textNode(node.value.slice(cursor)));
  return output;
}

function paragraphText(node: CompatibleNode): string | undefined {
  if (node.type !== 'paragraph' || node.children.length !== 1 || node.children[0]?.type !== 'text') return undefined;
  return node.children[0].value;
}

function spoilerNode(title: string, children: RootContent[]): RootContent {
  return {
    type: 'containerDirective',
    name: 'spoiler',
    attributes: {},
    data: { hackmdTitle: title },
    children,
  } as RootContent;
}

function normalizeSpaceSpoilers(parent: CompatibleParent): void {
  let index = 0;
  while (index < parent.children.length) {
    const opening = paragraphText(parent.children[index] as CompatibleNode);
    const openingMatch = opening ? /^:::spoiler[ \t]+([^\r\n]+)$/u.exec(opening) : null;
    if (openingMatch?.[1]) {
      const closingIndex = parent.children.findIndex((candidate, candidateIndex) =>
        candidateIndex > index && paragraphText(candidate)?.trim() === ':::');
      if (closingIndex > index) {
        const body = parent.children.slice(index + 1, closingIndex) as RootContent[];
        parent.children.splice(index, closingIndex - index + 1, spoilerNode(openingMatch[1].trim(), body));
        index += 1;
        continue;
      }
    }

    const paragraph = parent.children[index];
    if (paragraph?.type === 'paragraph' && paragraph.children.length > 0) {
      const first = paragraph.children[0];
      const last = paragraph.children.at(-1);
      if (first?.type === 'text' && last?.type === 'text') {
        const compactMatch = /^:::spoiler[ \t]+([^\r\n]+)\r?\n/u.exec(first.value);
        if (compactMatch?.[1] && /\r?\n:::$/.test(last.value)) {
          const children = [...paragraph.children];
          const firstText = first.value.slice(compactMatch[0].length);
          const lastText = last.value.replace(/\r?\n:::$/u, '');
          if (first === last) {
            children[0] = textNode(firstText.replace(/\r?\n:::$/u, ''));
          } else {
            children[0] = textNode(firstText);
            children[children.length - 1] = textNode(lastText);
          }
          const content = children.filter((child) => child.type !== 'text' || child.value.length > 0);
          parent.children.splice(index, 1, spoilerNode(compactMatch[1].trim(), [{ type: 'paragraph', children: content }]));
        }
      }
    }
    index += 1;
  }
}

function isStandaloneToc(node: CompatibleNode): node is Paragraph {
  return node.type === 'paragraph'
    && node.children.length === 1
    && node.children[0]?.type === 'text'
    && node.children[0].value.trim().toUpperCase() === '[TOC]';
}

function transformChildren(parent: CompatibleParent, source: string): void {
  normalizeSpaceSpoilers(parent);
  let index = 0;
  while (index < parent.children.length) {
    const node = parent.children[index];
    if (!node) break;

    if (hasChildren(node)) transformChildren(node, source);
    if (node.type === 'text') {
      const replacement = transformInlineText(node, source);
      if (replacement.length !== 1 || replacement[0] !== node) {
        parent.children.splice(index, 1, ...replacement);
        index += replacement.length;
        continue;
      }
    }
    if (node.type === 'code') normalizeCodeLanguage(node);
    if (node.type === 'blockquote') transformAlert(node);

    if (isStandaloneToc(node)) {
      parent.children.splice(index, 1);
      continue;
    }

    if (node.type === 'containerDirective') {
      if (transformContainer(node)) {
        index += 1;
      } else {
        parent.children.splice(index, 1, ...node.children);
        index += node.children.length;
      }
      continue;
    }

    if (node.type === 'leafDirective' || node.type === 'textDirective') {
      parent.children.splice(index, 1, ...node.children);
      index += node.children.length;
      continue;
    }

    index += 1;
  }
}

export function remarkHackmdCompatibility() {
  return (tree: Root, file?: { value?: unknown }) => {
    transformChildren(tree as CompatibleParent, typeof file?.value === 'string' ? file.value : '');
  };
}
