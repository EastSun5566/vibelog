import type { Blockquote, Code, Paragraph, PhrasingContent, Root, RootContent } from 'mdast';

type CompatibleNode = Root | RootContent | PhrasingContent;
type CompatibleParent = CompatibleNode & { children: CompatibleNode[] };
interface HastData {
  directiveLabel?: boolean | null;
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
  const match = /^([a-z][a-z0-9+#.-]*)(?:=(?:\d+|\+)?)$/iu.exec(node.lang);
  if (match?.[1]) node.lang = match[1];
}

function isStandaloneToc(node: CompatibleNode): node is Paragraph {
  return node.type === 'paragraph'
    && node.children.length === 1
    && node.children[0]?.type === 'text'
    && node.children[0].value.trim().toUpperCase() === '[TOC]';
}

function transformChildren(parent: CompatibleParent): void {
  let index = 0;
  while (index < parent.children.length) {
    const node = parent.children[index];
    if (!node) break;

    if (hasChildren(node)) transformChildren(node);
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
  return (tree: Root) => {
    transformChildren(tree as CompatibleParent);
  };
}
