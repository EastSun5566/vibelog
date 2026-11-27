/**
 * Proves a writer owns a HackMD account: HackMD has no third-party sign-in, so the writer pastes a
 * personal API token and VibeLog asks HackMD whose it is. HackMD tokens carry full account
 * access, so the token is used for this one request only: never stored, logged or echoed.
 */

export class HackmdTokenError extends Error {
  constructor(readonly reason: 'invalid' | 'unavailable') {
    super(
      reason === 'invalid'
        ? 'HackMD did not accept this token. Create a new one and paste it again.'
        : 'HackMD could not confirm the token right now. Please try again shortly.',
    );
    this.name = 'HackmdTokenError';
  }
}

export interface HackmdIdentityOptions {
  /** HackMD API v1 base, for example https://api.hackmd.io/v1 */
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Returns the `userPath` of the account that owns the token (the name in hackmd.io/@name). */
export async function hackmdTokenOwner(
  token: string,
  { apiUrl, fetch = globalThis.fetch, timeoutMs = 10_000 }: HackmdIdentityOptions,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/+$/u, '')}/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HackmdTokenError('unavailable');
  }
  if (response.status === 401 || response.status === 403) throw new HackmdTokenError('invalid');
  if (!response.ok) throw new HackmdTokenError('unavailable');
  const body = (await response.json().catch(() => null)) as { userPath?: unknown } | null;
  if (typeof body?.userPath !== 'string' || body.userPath.length === 0)
    throw new HackmdTokenError('unavailable');
  return body.userPath;
}
