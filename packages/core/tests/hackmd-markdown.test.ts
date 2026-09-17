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

  it('supports common safe inline syntax and space-titled spoilers', () => {
    const source = ':::spoiler Terminal output\n\nSecret body.\n\n:::\n\n==mark== ++insert++ H~2~O x^2^ {漢字|かんじ}';
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: ':::spoiler Terminal output' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'Secret body.' }] },
        { type: 'paragraph', children: [{ type: 'text', value: ':::' }] },
        { type: 'paragraph', children: [{ type: 'text', value: '==mark== ++insert++ H~2~O x^2^ {漢字|かんじ}' }] },
      ],
    } as Root;

    remarkHackmdCompatibility()(tree, { value: source });

    expect(tree.children[0]).toMatchObject({
      type: 'containerDirective',
      data: { hName: 'details', hProperties: { className: ['spoiler'] } },
      children: [
        { data: { hName: 'summary' }, children: [{ value: 'Terminal output' }] },
        { children: [{ value: 'Secret body.' }] },
      ],
    });
    expect(tree.children[1]).toMatchObject({ type: 'paragraph' });
    const inline = JSON.stringify(tree.children[1]);
    for (const hName of ['mark', 'ins', 'sub', 'sup', 'ruby', 'rt']) {
      expect(inline).toContain(`"hName":"${hName}"`);
    }
  });

  it('supports open spoilers without passing through unknown attributes', () => {
    const source = ':::spoiler {state="open" class="untrusted"} Terminal output\n\nSecret body.\n\n:::';
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: ':::spoiler {state="open" class="untrusted"} Terminal output' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'Secret body.' }] },
        { type: 'paragraph', children: [{ type: 'text', value: ':::' }] },
      ],
    } as Root;

    remarkHackmdCompatibility()(tree, { value: source });

    expect(tree.children[0]).toMatchObject({
      type: 'containerDirective',
      data: { hName: 'details', hProperties: { className: ['spoiler'], open: true } },
    });
    expect((tree.children[0] as { children: unknown[] }).children[0]).toMatchObject({
      data: { hName: 'summary' },
      children: [{ value: 'Terminal output' }],
    });
    expect(tree.children[0]).not.toHaveProperty('data.hProperties.class');
    expect(JSON.stringify(tree.children[0])).not.toContain('untrusted');
  });

  it('normalizes HackMD line numbers, continuation, and wrapped plaintext fences', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'code', lang: 'javascript=', value: 'one\ntwo' },
        { type: 'code', lang: 'typescript=101', value: 'three\nfour' },
        { type: 'code', lang: 'typescript=+', value: 'five' },
        { type: 'code', lang: '!', value: 'A long plaintext line' },
      ],
    } as Root;

    remarkHackmdCompatibility()(tree);

    expect(tree.children).toMatchObject([
      { type: 'code', lang: 'javascript', meta: 'line-start=1' },
      { type: 'code', lang: 'typescript', meta: 'line-start=101' },
      { type: 'code', lang: 'typescript', meta: 'line-start=103' },
      { type: 'code', lang: 'text', meta: 'wrap-code' },
    ]);
  });

  it('keeps escaped inline markers literal', () => {
    const source = '\\==literal==';
    const tree = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{
          type: 'text',
          value: '==literal==',
          position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 13, offset: 12 } },
        }],
      }],
    } as Root;

    remarkHackmdCompatibility()(tree, { value: source });

    expect(tree.children[0]).toMatchObject({ children: [{ type: 'text', value: '==literal==' }] });
  });
});
