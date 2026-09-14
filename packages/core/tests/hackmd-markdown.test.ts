import type { Root } from 'mdast';
import { describe, expect, it } from 'vitest';
import { remarkHackmdCompatibility } from '../src/markdown/hackmd.js';

describe('remarkHackmdCompatibility', () => {
  it('normalizes safe HackMD structures and unwraps unknown directives', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: '[TOC]' }] },
        { type: 'code', lang: 'javascript=101', value: 'const answer = 42;' },
        {
          type: 'containerDirective',
          name: 'info',
          attributes: { class: 'untrusted' },
          children: [
            { type: 'paragraph', data: { directiveLabel: true }, children: [{ type: 'text', value: 'Background' }] },
            { type: 'paragraph', children: [{ type: 'text', value: 'Safe content' }] },
          ],
        },
        {
          type: 'containerDirective',
          name: 'custom-element',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Keep me' }] }],
        },
      ],
    } as Root;

    remarkHackmdCompatibility()(tree);

    expect(tree.children).toHaveLength(3);
    expect(tree.children[0]).toMatchObject({ type: 'code', lang: 'javascript' });
    expect(tree.children[1]).toMatchObject({
      type: 'containerDirective',
      data: {
        hName: 'aside',
        hProperties: {
          ariaLabel: 'Background',
          className: ['callout', 'callout-info'],
        },
      },
    });
    expect(tree.children[1]).not.toHaveProperty('data.hProperties.class', 'untrusted');
    expect(tree.children[2]).toMatchObject({ type: 'paragraph', children: [{ value: 'Keep me' }] });
  });

  it('turns GitHub alerts into labelled callouts without changing regular quotes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: '[!WARNING] Custom warning\nBe careful.' }] }],
        },
        {
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A regular quotation.' }] }],
        },
      ],
    } as Root;

    remarkHackmdCompatibility()(tree);

    expect(tree.children[0]).toMatchObject({
      type: 'blockquote',
      data: {
        hName: 'aside',
        hProperties: {
          ariaLabel: 'Custom warning',
          className: ['callout', 'callout-warning'],
        },
      },
      children: [
        { data: { hName: 'p' }, children: [{ value: 'Custom warning' }] },
        { children: [{ value: 'Be careful.' }] },
      ],
    });
    expect(tree.children[1]).not.toHaveProperty('data.hName');
  });
});
