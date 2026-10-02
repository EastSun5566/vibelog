export interface Credentials { token: string; expiresAt: string }
export interface CredentialStore {
  get(): Promise<Credentials | null>;
  set: (credentials: Credentials) => Promise<void>;
  delete(): Promise<void>;
  check(): Promise<void>;
}

export async function secureStore(origin: string): Promise<CredentialStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  const entry = new AsyncEntry('org.vibelog.cli', origin, { linux: { store: 'secret-service' } });
  const probe = new AsyncEntry('org.vibelog.cli.probe', origin, { linux: { store: 'secret-service' } });
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
    async delete() { await entry.deletePassword(); },
  };
}
