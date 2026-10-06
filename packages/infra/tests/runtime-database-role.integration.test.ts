import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../app/src/database.js';
import { RuntimeDatabaseRoleProvider } from '../src/runtime-database-role.js';

const testUrl = process.env.TEST_DATABASE_URL;
const run = promisify(execFile);
describe.skipIf(!testUrl)('SQL-created runtime role (isolated PostgreSQL database)', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const name = `role_test_${suffix}`;
  const ownerName = `owner_${suffix}`;
  const roleName = `runtime_${suffix}`;
  const root = new Client({ connectionString: testUrl });
  const provider = new RuntimeDatabaseRoleProvider();
  let owner: Client;
  let runtime: Client;
  let database: AppDatabase;
  let state: NonNullable<Awaited<ReturnType<typeof provider.create>>['outs']>;
  let id: string;
  let inputs: { adminUrl: string; projectId: string; roleName: string; policyVersion: number };
  beforeAll(async () => {
    await root.connect();
    // Model a Neon owner: can manage roles and its database, but is not a superuser.
    await root.query(`CREATE ROLE ${ownerName} LOGIN CREATEDB CREATEROLE PASSWORD 'local-owner-test'`);
    await root.query(`CREATE DATABASE ${name} OWNER ${ownerName}`);
    if (!testUrl) throw new Error('Missing local test database URL');
    const url = new URL(testUrl); url.pathname = `/${name}`; url.username = ownerName; url.password = 'local-owner-test';
    inputs = { adminUrl: url.toString(), projectId: name, roleName, policyVersion: 1 };
    owner = new Client({ connectionString: inputs.adminUrl }); await owner.connect();
    await owner.query('CREATE TABLE existing (id serial PRIMARY KEY, value text)');
    await owner.query("INSERT INTO existing(value) VALUES ('retained')");
    const result = await provider.create(inputs);
    if (!result.outs) throw new Error('Missing test role state');
    state = result.outs; id = result.id;
    url.username = roleName; url.password = state.password;
    runtime = new Client({ connectionString: url.toString() }); await runtime.connect();
    const { AppDatabase } = await import('../../app/src/database.js');
    database = new AppDatabase(url.toString());
    // Use the real migration entrypoint with the owner URL only in the child environment.
    try {
      await run(process.execPath, [fileURLToPath(new URL('../../app/dist/migrate.js', import.meta.url))], { env: { ...process.env, DATABASE_MIGRATION_URL: inputs.adminUrl } });
    } catch { throw new Error('Isolated owner migration failed; build the app before running this test'); }
  }, 30_000);
  afterAll(async () => {
    await database?.close(); await runtime?.end(); await owner?.end();
    // Only this test's randomly named database/roles are removed.
    await root.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await root.query(`DROP ROLE IF EXISTS ${roleName}`);
    await root.query(`DROP ROLE IF EXISTS ${ownerName}`);
    await root.end();
  });
  it('preserves existing data and grants DML on future tables/sequences', async () => {
    expect((await runtime.query<{ value: string }>('SELECT value FROM existing')).rows[0].value).toBe('retained');
    await runtime.query("INSERT INTO existing(value) VALUES ('new')");
    await runtime.query("UPDATE existing SET value = 'edited' WHERE value = 'new'");
    expect((await runtime.query("DELETE FROM existing WHERE value = 'edited' RETURNING id")).rowCount).toBe(1);
    await owner.query('CREATE TABLE future (id serial PRIMARY KEY, value text)');
    expect((await runtime.query<{ id: number }>("INSERT INTO future(value) VALUES ('future') RETURNING id")).rows[0].id).toBe(1);
  });
  it('runs real magic-link auth, session reads, operation transactions and cleanup as runtime', async () => {
    const { createAuth } = await import('../../app/src/auth.js');
    const { loadAppConfig } = await import('../../app/src/config.js');
    const config = loadAppConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgresql://unused',
      BETTER_AUTH_SECRET: 'local-test-auth-secret-at-least-thirty-two-characters',
      OBJECT_STORE_ENDPOINT: 'http://localhost:9000', OBJECT_STORE_BUCKET: 'unused', OBJECT_STORE_ACCESS_KEY_ID: 'unused', OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
      EMAIL_PROVIDER: 'mailpit', MAILPIT_API_URL: 'http://localhost:8025', EMAIL_FROM: 'login@example.com' });
    let link = '';
    const auth = createAuth(database, config, { sendMagicLink: (message) => { link = message.url; return Promise.resolve(); } });
    const headers = { Origin: config.appOrigin };
    const response = await auth.handler(new Request(`${config.appOrigin}/api/auth/sign-in/magic-link`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${suffix}@example.com`, callbackURL: '/editor' }),
    }));
    expect(response.status).toBe(200);
    const signedIn = await auth.handler(new Request(link, { headers }));
    expect(signedIn.status).toBe(302);
    const cookie = signedIn.headers.getSetCookie().find((value) => value.startsWith('vibelog.session_token='))?.split(';')[0];
    expect(Boolean(cookie)).toBe(true);
    if (!cookie) throw new Error('Missing local test cookie');
    const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    expect(Boolean(session)).toBe(true);
    if (!session) throw new Error('Missing local test session');
    const { operation } = await database.createBlog(session.user.id, `writer-${suffix.slice(0, 8)}`, 'writer');
    expect((await database.listPendingOutbox()).some((item) => item.operationId === operation.id)).toBe(true);
    expect(await database.claimOperation(operation.id)).not.toBeNull();
    await runtime.query('DELETE FROM "user" WHERE id = $1', [session.user.id]);
    expect((await runtime.query('SELECT * FROM operations')).rowCount).toBe(0);
  });
  it('denies DDL, owner escalation, grants, truncate, sequence mutation and migration journal access', async () => {
    for (const sql of [
      'CREATE TABLE forbidden (id int)', 'CREATE SCHEMA forbidden', 'CREATE TEMP TABLE forbidden (id int)',
      'ALTER TABLE existing ADD COLUMN forbidden int', 'DROP TABLE existing', 'TRUNCATE existing',
      `CREATE ROLE forbidden_${suffix}`, `SET ROLE ${ownerName}`, 'SELECT * FROM drizzle.__drizzle_migrations',
      "SELECT setval('existing_id_seq', 999)",
    ]) await expect(runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
    expect((await runtime.query<{ current_user: string }>('SELECT current_user')).rows[0].current_user).toBe(roleName);
    // PostgreSQL may return a warning rather than an error for an ineffective GRANT.
    await runtime.query(`GRANT SELECT ON existing TO ${roleName} WITH GRANT OPTION`);
    expect((await owner.query<{ allowed: boolean }>("SELECT has_table_privilege($1, 'existing', 'SELECT WITH GRANT OPTION') AS allowed", [roleName])).rows[0].allowed).toBe(false);
  });
  it('keeps the generated password stable, repairs ACL drift and refuses membership/ownership drift', async () => {
    expect((await provider.diff(id, state, inputs)).changes).toBe(false);
    expect((await provider.read(id, state)).props?.policyApplied).toBe(true);
    await owner.query(`REVOKE SELECT ON existing FROM ${roleName}`);
    const drifted = (await provider.read(id, state)).props;
    if (!drifted) throw new Error('Missing local test role state');
    expect(drifted.policyApplied).toBe(false);
    expect((await provider.diff(id, drifted, inputs)).changes).toBe(true);
    const updated = (await provider.update(id, drifted, inputs)).outs;
    if (!updated) throw new Error('Missing local test updated state');
    expect(updated.password === state.password).toBe(true);
    expect((await runtime.query('SELECT * FROM existing')).rowCount).toBe(1);
    await root.query(`GRANT pg_read_all_data TO ${roleName}`);
    expect((await provider.read(id, state)).props?.policyApplied).toBe(false);
    await expect(provider.update(id, state, inputs)).rejects.toThrow('unexpected attributes, memberships or object ownership');
    await root.query(`REVOKE pg_read_all_data FROM ${roleName}`);
    if (!testUrl) throw new Error('Missing local test database URL');
    const rootUrl = new URL(testUrl); rootUrl.pathname = `/${name}`;
    const databaseAdmin = new Client({ connectionString: rootUrl.toString() }); await databaseAdmin.connect();
    try {
      await databaseAdmin.query(`ALTER TABLE existing OWNER TO ${roleName}`);
      await expect(provider.update(id, state, inputs)).rejects.toThrow('unexpected attributes, memberships or object ownership');
      await databaseAdmin.query(`ALTER TABLE existing OWNER TO ${ownerName}`);
    } finally { await databaseAdmin.end(); }
    await provider.update(id, state, inputs);
  });
  it('refuses existing-role adoption and keeps PostgreSQL diagnostics secret', async () => {
    await expect(provider.create(inputs)).rejects.toThrow('refusing to adopt or overwrite');
    const invalid = { ...inputs, roleName: ownerName };
    await expect(provider.create(invalid)).rejects.toThrow('Invalid runtime database role');
    await expect(provider.create({ ...inputs, adminUrl: 'invalid-private-test-url' })).rejects.toThrow(/^Invalid database connection URL$/u);
    const bad = new URL(inputs.adminUrl); bad.password = 'never-print-this-password';
    await expect(provider.create({ ...inputs, adminUrl: bad.toString() })).rejects.toThrow(/^Runtime database role operation failed \(28P01\)$/u);
  });
  it('removes only its managed role and ACL references when explicitly deleted', async () => {
    await provider.delete(id, state);
    expect((await provider.read(id, state)).id).toBeUndefined();
    expect((await owner.query('SELECT * FROM existing')).rowCount).toBe(1);
  });
});
