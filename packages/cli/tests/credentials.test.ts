import { describe, expect, it, vi } from 'vitest';
import { secureStore } from '../src/credentials.js';

const vault = vi.hoisted(() => new Map<string, string>());
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    readonly key: string;
    constructor(service: string, account: string) { this.key = `${service}:${account}`; }
    getPassword() { return Promise.resolve(vault.get(this.key) ?? null); }
    setPassword(value: string) { vault.set(this.key, value); return Promise.resolve(); }
    deletePassword() { vault.delete(this.key); return Promise.resolve(); }
  },
}));

describe('OS credential store entries', () => {
  it('isolates pending approval from grants and from other origins across store instances', async () => {
    const first = await secureStore('https://vibelog.org'); const reopened = await secureStore('https://vibelog.org');
    const other = await secureStore('https://other.example');
    const pairing = { deviceCode: 'd'.repeat(43), userCode: 'AABBCCDDEE', authorizationUrl: 'https://vibelog.org/agent/authorize?code=AABBCCDDEE', expiresAt: '2099-01-01' };
    await first.check(); await first.setPairing(pairing);
    expect(await reopened.getPairing()).toMatchObject(pairing); expect(await reopened.get()).toBeNull(); expect(await other.getPairing()).toBeNull();
    await first.set({ token: 'private-test-grant', expiresAt: '2099-01-01' }); await reopened.deletePairing();
    expect(await reopened.get()).toMatchObject({ token: 'private-test-grant' }); expect(await first.getPairing()).toBeNull(); expect(await other.get()).toBeNull();
    await reopened.delete();
    expect(await first.get()).toBeNull(); expect([...vault.keys()].some((key) => key.startsWith('org.vibelog.cli.probe:'))).toBe(false);
  });
});
