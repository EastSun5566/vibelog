import { randomBytes } from 'node:crypto';

export function generateSlug(length = 8): string {
  return randomBytes(length / 2).toString('hex');
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, ''); // Remove leading and trailing hyphens
}
