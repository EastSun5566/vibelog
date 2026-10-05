import * as pulumi from '@pulumi/pulumi';
import type { Client } from 'pg';

interface RoleInputs {
  adminUrl: string;
  projectId: string;
  roleName: string;
  policyVersion: number;
}
interface RoleState extends RoleInputs { password: string; policyApplied: boolean }
class RolePolicyError extends Error {}

function identifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function roleMarker(inputs: RoleInputs): string { return `VibeLog runtime role: ${inputs.projectId}`; }
function connectionUrl(value: string): URL {
  try { return new URL(value); }
  catch { throw new RolePolicyError('Invalid database connection URL'); }
}
function target(url: string): string { const parsed = connectionUrl(url); return `${parsed.host}${parsed.pathname}`; }

async function withAdmin<T>(inputs: RoleInputs, work: (client: Client) => Promise<T>): Promise<T> {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(inputs.roleName) || inputs.roleName === decodeURIComponent(connectionUrl(inputs.adminUrl).username)) throw new RolePolicyError('Invalid runtime database role');
  // Dynamic providers are serialized as CommonJS closures, like the Resend providers.
  // oxlint-disable-next-line typescript/no-require-imports
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({ connectionString: inputs.adminUrl, connectionTimeoutMillis: 15_000, query_timeout: 30_000 });
  try { await client.connect(); return await work(client); }
  catch (error) {
    if (error instanceof RolePolicyError) throw error;
    const code = error && typeof error === 'object' && 'code' in error && /^[A-Z0-9]{5}$/u.test(String(error.code)) ? String(error.code) : 'connection_or_query_error';
    // PostgreSQL errors can contain the CREATE ROLE statement, including its password.
    throw new RolePolicyError(`Runtime database role operation failed (${code})`);
  } finally { await client.end().catch(() => undefined); }
}

async function roleStatus(client: Client, inputs: RoleInputs) {
  const { rows } = await client.query<{ managed: boolean; safe: boolean }>(`
    SELECT shobj_description(r.oid, 'pg_authid') = $2 AS managed,
      r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proowner = r.oid) AS safe
    FROM pg_roles r WHERE r.rolname = $1`, [inputs.roleName, roleMarker(inputs)]);
  return rows[0];
}

async function assertManaged(client: Client, inputs: RoleInputs): Promise<void> {
  const status = await roleStatus(client, inputs);
  if (!status?.managed) throw new RolePolicyError('Runtime role is missing or is not owned by this stack');
  if (!status.safe) throw new RolePolicyError('Runtime role has unexpected attributes, memberships or object ownership; inspect before changing it');
}

async function policyValid(client: Client, inputs: RoleInputs): Promise<boolean> {
  const status = await roleStatus(client, inputs);
  if (!status?.managed || !status.safe) return false;
  const { rows } = await client.query<{ valid: boolean }>(`
    SELECT has_database_privilege($1, current_database(), 'CONNECT')
      AND NOT has_database_privilege($1, current_database(), 'CREATE')
      AND NOT has_database_privilege($1, current_database(), 'TEMP')
      AND has_schema_privilege($1, 'public', 'USAGE') AND NOT has_schema_privilege($1, 'public', 'CREATE')
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE has_schema_privilege($1, oid, 'CREATE'))
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle' AND has_schema_privilege($1, oid, 'USAGE'))
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND (
          NOT (has_table_privilege($1, c.oid, 'SELECT') AND has_table_privilege($1, c.oid, 'INSERT')
            AND has_table_privilege($1, c.oid, 'UPDATE') AND has_table_privilege($1, c.oid, 'DELETE'))
          OR has_table_privilege($1, c.oid, 'TRUNCATE') OR has_table_privilege($1, c.oid, 'TRIGGER')
          OR has_table_privilege($1, c.oid, 'REFERENCES') OR has_table_privilege($1, c.oid, 'MAINTAIN')
          OR has_table_privilege($1, c.oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION, DELETE WITH GRANT OPTION')))
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S' AND (
          NOT (has_sequence_privilege($1, c.oid, 'USAGE') AND has_sequence_privilege($1, c.oid, 'SELECT'))
          OR has_sequence_privilege($1, c.oid, 'UPDATE') OR has_sequence_privilege($1, c.oid, 'USAGE WITH GRANT OPTION, SELECT WITH GRANT OPTION')))
      AND (SELECT count(*) = 6 AND bool_and(NOT a.is_grantable AND
          ((d.defaclobjtype = 'r' AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
            OR (d.defaclobjtype = 'S' AND a.privilege_type IN ('USAGE', 'SELECT')))) FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype IN ('r', 'S')
          AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS valid`, [inputs.roleName]);
  return rows[0]?.valid ?? false;
}

async function configureRole(client: Client, inputs: RoleInputs, password: string | undefined): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [roleMarker(inputs)]);
    const role = identifier(inputs.roleName);
    const { rows: [admin] } = await client.query<{ database: string; owner: string }>('SELECT current_database() AS database, current_user AS owner');
    if (password !== undefined) {
      if (await roleStatus(client, inputs)) throw new RolePolicyError('Runtime role already exists; refusing to adopt or overwrite it');
      await client.query("SET LOCAL password_encryption = 'scram-sha-256'");
      await client.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD ${literal(password)}`);
      await client.query(`COMMENT ON ROLE ${role} IS ${literal(roleMarker(inputs))}`);
    }
    await assertManaged(client, inputs);
    // A role-specific REVOKE cannot override privileges inherited from PUBLIC.
    await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${identifier(admin.database)} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON DATABASE ${identifier(admin.database)} FROM ${role}`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(admin.database)} TO ${role}`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    const defaults = `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(admin.owner)} IN SCHEMA public`;
    await client.query(`${defaults} REVOKE ALL ON TABLES FROM ${role}`);
    await client.query(`${defaults} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
    await client.query(`${defaults} REVOKE ALL ON SEQUENCES FROM ${role}`);
    await client.query(`${defaults} GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
    if (!await policyValid(client, inputs)) throw new RolePolicyError('Runtime role still has unexpected effective privileges; inspect shared PUBLIC grants');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export class RuntimeDatabaseRoleProvider implements pulumi.dynamic.ResourceProvider<RoleInputs, RoleState> {
  async create(inputs: RoleInputs): Promise<pulumi.dynamic.CreateResult<RoleState>> {
    // oxlint-disable-next-line typescript/no-require-imports
    const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const password = randomBytes(32).toString('base64url');
    await withAdmin(inputs, (client) => configureRole(client, inputs, password));
    return { id: `${inputs.projectId}/${inputs.roleName}`, outs: { ...inputs, password, policyApplied: true } };
  }
  async read(id: pulumi.ID, props?: RoleState): Promise<pulumi.dynamic.ReadResult<RoleState>> {
    if (!props) throw new RolePolicyError('Runtime role state is required; import is not supported');
    return withAdmin(props, async (client) => {
      const status = await roleStatus(client, props);
      if (!status) return { id: undefined };
      if (!status.managed) throw new RolePolicyError('Runtime role is not owned by this stack');
      return { id, props: { ...props, policyApplied: await policyValid(client, props) } };
    });
  }
  diff(_id: pulumi.ID, olds: RoleState, news: RoleInputs): Promise<pulumi.dynamic.DiffResult> {
    const replaces = ['projectId', 'roleName'].filter((key) => olds[key as 'projectId' | 'roleName'] !== news[key as 'projectId' | 'roleName']);
    if (target(olds.adminUrl) !== target(news.adminUrl)) replaces.push('adminUrl');
    return Promise.resolve({ changes: replaces.length > 0 || olds.adminUrl !== news.adminUrl || olds.policyVersion !== news.policyVersion || !olds.policyApplied, replaces });
  }
  async update(_id: pulumi.ID, olds: RoleState, news: RoleInputs): Promise<pulumi.dynamic.UpdateResult<RoleState>> {
    await withAdmin(news, (client) => configureRole(client, news, undefined));
    return { outs: { ...news, password: olds.password, policyApplied: true } };
  }
  async delete(_id: pulumi.ID, props: RoleState): Promise<void> {
    await withAdmin(props, async (client) => {
      if (!await roleStatus(client, props)) return;
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [roleMarker(props)]);
        await assertManaged(client, props);
        const role = identifier(props.roleName);
        const { rows: [admin] } = await client.query<{ database: string; owner: string }>('SELECT current_database() AS database, current_user AS owner');
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(admin.owner)} IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`);
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(admin.owner)} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`);
        await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
        await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
        await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
        await client.query(`REVOKE ALL ON DATABASE ${identifier(admin.database)} FROM ${role}`);
        await client.query(`DROP ROLE ${role}`);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
}

export class RuntimeDatabaseRole extends pulumi.dynamic.Resource {
  declare readonly password: pulumi.Output<string>;
  constructor(name: string, args: { adminUrl: pulumi.Input<string>; projectId: pulumi.Input<string>; roleName: string }, opts?: pulumi.CustomResourceOptions) {
    super(new RuntimeDatabaseRoleProvider(), name, { ...args, adminUrl: pulumi.secret(args.adminUrl), policyVersion: 1, password: undefined, policyApplied: undefined }, {
      ...opts, protect: true, additionalSecretOutputs: [...(opts?.additionalSecretOutputs ?? []), 'adminUrl', 'password'],
    }, 'postgres', 'RuntimeRole');
    this.password = pulumi.secret(this.password);
  }
}

export function runtimeDatabaseUrl(ownerPoolerUrl: pulumi.Input<string>, roleName: string, password: pulumi.Input<string>): pulumi.Output<string> {
  return pulumi.secret(pulumi.all([ownerPoolerUrl, password]).apply(([source, value]) => {
    const url = connectionUrl(source); url.username = roleName; url.password = value;
    url.searchParams.set('sslmode', 'verify-full'); url.searchParams.set('channel_binding', 'require');
    return url.toString();
  }));
}

export function securePostgresUrl(source: pulumi.Input<string>): pulumi.Output<string> {
  return pulumi.secret(pulumi.output(source).apply((value) => {
    const url = connectionUrl(value);
    url.searchParams.set('sslmode', 'verify-full'); url.searchParams.set('channel_binding', 'require');
    return url.toString();
  }));
}
