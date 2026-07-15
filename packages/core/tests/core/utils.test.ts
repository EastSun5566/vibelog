import { describe, it, expect } from 'vitest';
import { generateSlug, slugify } from '../../src/core/utils.js';

describe('utils', () => {
  describe('generateSlug', () => {
    it('should generate a slug with default length', () => {
      const slug = generateSlug();
      expect(slug).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should generate a slug with custom length', () => {
      const slug = generateSlug(12);
      expect(slug).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should generate different slugs on each call', () => {
      const slug1 = generateSlug();
      const slug2 = generateSlug();
      expect(slug1).not.toBe(slug2);
    });
  });

  describe('slugify', () => {
    it('should convert text to lowercase', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should replace spaces with hyphens', () => {
      expect(slugify('hello world')).toBe('hello-world');
    });

    it('should remove special characters', () => {
      expect(slugify('hello@world!#')).toBe('hello-world');
    });

    it('should handle multiple spaces and special characters', () => {
      expect(slugify('  hello   world  @@@ test  ')).toBe('hello-world-test');
    });

    it('should handle empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('should handle string with only special characters', () => {
      expect(slugify('@#$%^&*()')).toBe('');
    });

    it('should collapse multiple hyphens', () => {
      expect(slugify('hello---world')).toBe('hello-world');
    });

    it('normalizes Unicode and never creates a subpath', () => {
      expect(slugify('Ｔｅｓｔ／中文/文章')).toBe('test-中文-文章');
      expect(slugify('Ｔｅｓｔ／中文/文章')).not.toMatch(/[\\/]/);
    });

    it('limits excessively long slugs', () => {
      expect(slugify('a'.repeat(200))).toHaveLength(80);
    });
  });
});
