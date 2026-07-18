import { createHash, randomBytes } from 'node:crypto';

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('base64url'); }
