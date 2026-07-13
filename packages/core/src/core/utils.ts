import { randomBytes } from 'node:crypto';

export function generateSlug(length = 8): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function slugify(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
