export interface Credentials { token: string; expiresAt: string }
export interface PendingPairing { deviceCode: string; userCode: string; authorizationUrl: string; expiresAt: string; nextPollAt?: number; canPublish?: boolean }
export interface CredentialStore {
  get(): Promise<Credentials | null>;
  set: (credentials: Credentials) => Promise<void>;
  delete(): Promise<void>;
  check(): Promise<void>;
  getPairing(): Promise<PendingPairing | null>;
  setPairing(pairing: PendingPairing): Promise<void>;
  deletePairing: () => Promise<void>;
}

export function parsePairing(value: unknown, origin: string): PendingPairing {
  if (!value || typeof value !== 'object' || !('deviceCode' in value) || !('userCode' in value) || !('authorizationUrl' in value) || !('expiresAt' in value)
    || typeof value.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.deviceCode)
    || typeof value.userCode !== 'string' || !/^[A-F0-9]{10}$/u.test(value.userCode)
    || typeof value.authorizationUrl !== 'string' || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('Invalid pairing');
  const url = new URL(value.authorizationUrl);
  if (url.origin !== origin || url.username || url.password || url.pathname !== '/agent/authorize' || url.search !== `?code=${value.userCode}` || url.hash) throw new Error('Untrusted authorization URL');
  const nextPollAt = 'nextPollAt' in value ? value.nextPollAt : undefined;
  if (nextPollAt !== undefined && (typeof nextPollAt !== 'number' || !Number.isFinite(nextPollAt) || nextPollAt < 0)) throw new Error('Invalid polling time');
  const canPublish = 'canPublish' in value ? value.canPublish : false;
  if (typeof canPublish !== 'boolean') throw new Error('Invalid permission');
  return { canPublish, deviceCode: value.deviceCode, userCode: value.userCode, authorizationUrl: url.href, expiresAt: value.expiresAt, nextPollAt };
}

export async function secureStore(origin: string): Promise<CredentialStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  const entry = new AsyncEntry('org.vibelog.cli', origin, { linux: { store: 'secret-service' } });
  const probe = new AsyncEntry('org.vibelog.cli.probe', origin, { linux: { store: 'secret-service' } });
  const pairing = new AsyncEntry('org.vibelog.cli.pairing', origin, { linux: { store: 'secret-service' } });
  return {
    async check() { await probe.setPassword('storage-check'); if (await probe.getPassword() !== 'storage-check') throw new Error('Secure storage unavailable'); await probe.deletePassword(); },
    async get() {
      const raw = await entry.getPassword(); if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || !('token' in value) || !('expiresAt' in value) || typeof value.token !== 'string' || typeof value.expiresAt !== 'string') throw new Error('Invalid credentials');
      if (new Date(value.expiresAt).getTime() <= Date.now()) { await entry.deletePassword(); return null; }
      return { token: value.token, expiresAt: value.expiresAt };
    },
    async set(value) { await entry.setPassword(JSON.stringify(value)); },
    async delete() { if (await entry.getPassword()) await entry.deletePassword(); },
    async getPairing() { const raw = await pairing.getPassword(); return raw ? parsePairing(JSON.parse(raw), origin) : null; },
    async setPairing(value) { await pairing.setPassword(JSON.stringify(value)); },
    async deletePairing() { if (await pairing.getPassword()) await pairing.deletePassword(); },
  };
}
