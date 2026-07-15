import { describe, it, expect } from 'vitest';
import { removeFirstH1IfMatchesTitle } from '../../../src/adapters/content/utils.js';

describe('Content Utils', () => {
  describe('removeFirstH1IfMatchesTitle', () => {
    it('should remove first H1 when it matches the title', () => {
      const markdown = `# My Blog Post

This is the content of my blog post.

## Section 1

More content here.`;
      const title = 'My Blog Post';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe(`This is the content of my blog post.

## Section 1

More content here.`);
    });

    it('should not remove H1 when it does not match the title', () => {
      const markdown = `# Different Title

This is the content.

## Section 1

More content.`;
      const title = 'My Blog Post';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe(markdown);
    });

    it('should return original markdown when no title is provided', () => {
      const markdown = `# Some Title

Content here.`;

      const result = removeFirstH1IfMatchesTitle(markdown);

      expect(result).toBe(markdown);
    });

    it('should return original markdown when title is empty', () => {
      const markdown = `# Some Title

Content here.`;

      const result = removeFirstH1IfMatchesTitle(markdown, '');

      expect(result).toBe(markdown);
    });

    it('should return original markdown when no H1 is found', () => {
      const markdown = `This is just regular content.

## Section 1

More content.`;
      const title = 'My Blog Post';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe(markdown);
    });

    it('should only remove the first H1, not subsequent ones', () => {
      const markdown = `# My Blog Post

Content here.

# Another H1

More content.`;
      const title = 'My Blog Post';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe(`Content here.

# Another H1

More content.`);
    });

    it('should handle H1 with extra whitespace', () => {
      const markdown = `#   My Blog Post   

Content here.`;
      const title = 'My Blog Post   '; // The function captures trailing whitespace

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe('Content here.');
    });

    it('should handle multiline content with leading newlines', () => {
      const markdown = `# My Title



Content starts here.`;
      const title = 'My Title';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe('Content starts here.');
    });

    it('should be case sensitive', () => {
      const markdown = `# my blog post

Content here.`;
      const title = 'My Blog Post';

      const result = removeFirstH1IfMatchesTitle(markdown, title);

      expect(result).toBe(markdown);
    });
  });
});
