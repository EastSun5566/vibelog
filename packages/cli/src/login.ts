import { AgentClient, CliError } from './client.js';
import { parsePairing, type PendingPairing } from './credentials.js';

export async function login(client: AgentClient, noWait: boolean, write: (value: unknown) => void, pause: (ms: number) => Promise<void>, now: () => number, allowPublish = false): Promise<number> {
  const { store } = client;
  const revoke = async (token: unknown) => {
    if (typeof token !== 'string' || !token) return;
    await client.fetcher(`${client.origin}/api/agent/v1/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
  };
  const storageError = () => new CliError('secure_storage_unavailable', 'Enable your OS credential store before signing in.');
  await store.check().catch(() => { throw storageError(); });
  const credentials = await store.get().catch(() => { throw storageError(); });
  let pairing = await store.getPairing().catch(() => { throw storageError(); });
  if (pairing && Boolean(pairing.canPublish) !== allowPublish) throw new CliError('pairing_permission_conflict', 'A login with different permissions is pending. Finish it with its original flags, or explicitly logout before starting another.');
  if (credentials) {
    try {
      const session = await client.request('/session');
      if (!allowPublish || session.canPublish === true) {
        await store.deletePairing().catch(() => { throw storageError(); });
        write({ status: 'authorized', expiresAt: session.expiresAt, permission: 'draft:read-write', canPublish: session.canPublish === true }); return 0;
      }
    } catch (error) {
      if (!(error instanceof CliError) || !['login_required', 'agent_unauthorized'].includes(error.code)) throw error;
      await store.delete().catch(() => { throw storageError(); });
    }
  }
  const approval = (value: PendingPairing) => {
    const retryAfterSeconds = Math.max(0, Math.ceil(((value.nextPollAt ?? 0) - now()) / 1000));
    write({ status: 'approval_required', authorizationUrl: value.authorizationUrl, userCode: value.userCode, expiresAt: value.expiresAt, canPublish: Boolean(value.canPublish), permission: 'draft:read-write', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
  };
  const expired = async () => {
    await store.deletePairing().catch(() => { throw storageError(); });
    throw new CliError('pairing_expired', 'Approval expired. Run login again to start a new request.');
  };
  if (pairing && Date.parse(pairing.expiresAt) <= now()) await expired();
  if (!pairing) {
    const result = await client.request('/pairings', 'POST', { canPublish: allowPublish }, undefined, true);
    try { pairing = parsePairing(result, client.origin); }
    catch { throw new CliError('invalid_response', 'Invalid pairing response.'); }
    if (Boolean(pairing.canPublish) !== allowPublish) throw new CliError('publish_permission_unavailable', 'The service does not support the requested publishing permission. Keep existing access and use the editor.');
    pairing.expiresAt = new Date(Math.min(now() + 600_000, Date.parse(pairing.expiresAt))).toISOString();
    pairing.nextPollAt = now() + 5000;
    await store.setPairing(pairing).catch(() => { throw storageError(); });
    if (Date.parse(pairing.expiresAt) <= now()) await expired();
    if (noWait) { approval(pairing); return 0; }
  }
  if (!noWait) approval(pairing);
  while (now() < Date.parse(pairing.expiresAt)) {
    const delay = Math.max(0, (pairing.nextPollAt ?? 0) - now());
    if (delay && noWait) { approval(pairing); return 0; }
    if (delay) await pause(Math.min(delay, Math.max(0, Date.parse(pairing.expiresAt) - now())));
    if (now() >= Date.parse(pairing.expiresAt)) break;
    // Persist the poll interval before redemption so a resumed process cannot poll too quickly.
    pairing.nextPollAt = now() + 5000;
    await store.setPairing(pairing).catch(() => { throw storageError(); });
    let result;
    try { result = await client.request('/pairings/token', 'POST', { deviceCode: pairing.deviceCode }, undefined, true, Date.parse(pairing.expiresAt) - now()); }
    catch (error) {
      if (!(error instanceof CliError)) throw error;
      if (['pairing_expired', 'pairing_denied'].includes(error.code)) {
        await store.deletePairing().catch(() => { throw storageError(); });
        throw new CliError(error.code, 'Approval expired, was denied, or was already used. Run login again to start a new request.', undefined, { status: error.status, requestId: error.requestId, recovery: { action: 'restart_login' } });
      }
      if (error.status === 429) {
        pairing.nextPollAt = now() + Math.max(5, error.retryAfterSeconds ?? 5) * 1000;
        await store.setPairing(pairing).catch(() => { throw storageError(); });
        if (!noWait) continue;
      }
      throw error;
    }
    if (result.status === 'approved') {
      if (Boolean(result.canPublish) !== allowPublish || (result.canPublish !== undefined && typeof result.canPublish !== 'boolean') || typeof result.token !== 'string' || !result.token || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= now()) {
        await revoke(result.token);
        throw new CliError('invalid_response', 'Invalid authorization response.');
      }
      try { await store.set({ token: result.token, expiresAt: result.expiresAt }); }
      catch {
        await revoke(result.token);
        throw new CliError('secure_storage_unavailable', 'Could not save authorization. Revoke any remaining access in the browser, then sign in again.');
      }
      await store.deletePairing().catch(() => { throw storageError(); });
      if (credentials && credentials.token !== result.token) await revoke(credentials.token);
      write({ status: 'authorized', expiresAt: result.expiresAt, permission: 'draft:read-write', canPublish: result.canPublish === true }); return 0;
    }
    if (result.status !== 'pending') throw new CliError('invalid_response', 'Invalid authorization response.');
    // The server starts its polling interval while handling this request, not before it.
    pairing.nextPollAt = now() + 5000;
    await store.setPairing(pairing).catch(() => { throw storageError(); });
    if (noWait) { approval(pairing); return 0; }
  }
  return expired();
}
