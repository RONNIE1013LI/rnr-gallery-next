import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { databaseHostFingerprint } from "./migration-safety";

type RuntimeRoleCapabilities = Readonly<{
  superuser: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  bypassRls: boolean;
  schemaCreate: boolean;
  tableOwnership: number;
  canCreateTable: boolean;
  canCreateRole: boolean;
  canCreateDatabase: boolean;
  canAlterTable: boolean;
  canDropTable: boolean;
  memberOfRoles: number;
  roleMembers: number;
  nonPublicTableGrants: number;
  ownedObjects: number;
  functionPrivileges: number;
  functionSignatures: readonly string[];
  unexpectedSchemaPrivileges: number;
  nonPublicSequencePrivileges: number;
  nonPublicFunctionPrivileges: number;
  databaseCreatePrivileges: number;
  currentDatabaseConnect: boolean;
  databaseTemporaryPrivileges: number;
  otherDatabaseConnectPrivileges: number;
  otherDatabaseTemporaryPrivileges: number;
  unexpectedPublicTablePrivileges: number;
  unexpectedPublicSequencePrivileges: number;
  missingPublicTablePrivileges: number;
  missingPublicSequencePrivileges: number;
}>;

type RuntimeRoleInventory = Readonly<{
  roleName: string;
  database: string;
  hostFingerprint: string;
  superuser: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  bypassRls: boolean;
  schemaCreate: boolean;
  tableOwnership: number;
  tablePrivileges: number;
  sequencePrivileges: number;
  functionPrivileges: number;
  functionSignatures: readonly string[];
  memberOfRoles: number;
  roleMembers: number;
  nonPublicTableGrants: number;
  ownedObjects: number;
  unexpectedSchemaPrivileges: number;
  nonPublicSequencePrivileges: number;
  nonPublicFunctionPrivileges: number;
  databaseCreatePrivileges: number;
  currentDatabaseConnect: boolean;
  databaseTemporaryPrivileges: number;
  otherDatabaseConnectPrivileges: number;
  otherDatabaseTemporaryPrivileges: number;
  unexpectedPublicTablePrivileges: number;
  unexpectedPublicSequencePrivileges: number;
  missingPublicTablePrivileges: number;
  missingPublicSequencePrivileges: number;
}>;

type RuntimeRoleAttributes = Readonly<{
  canLogin: boolean;
  inherit: boolean;
  superuser: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  bypassRls: boolean;
}>;

type RuntimeRoleMembership = Readonly<{
  grantedRole: string;
  memberRole: string;
}>;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function assertSafeIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error("PostgreSQL identifier is invalid");
  }
  if (value.startsWith("pg_") || value === "public" || value === "information_schema") {
    throw new Error("PostgreSQL identifier uses a reserved namespace");
  }
  return value;
}

export const RUNTIME_FUNCTION_ALLOWLIST = Object.freeze([
  "customer_service_mark_ui_change(text, text)",
  "customer_service_mark_ui_feedback_change()",
  "customer_service_mark_ui_image_input_change()",
  "customer_service_mark_ui_metrics_change()",
  "customer_service_mark_ui_review_alert_change()",
  "customer_service_mark_ui_row_change()",
]);

export function runtimeRoleAttributesAreSafe(input: RuntimeRoleAttributes) {
  return input.canLogin && !input.inherit && !input.superuser && !input.createRole &&
    !input.createDatabase && !input.replication && !input.bypassRls;
}

export function unexpectedRuntimeRoleMemberships(
  memberships: readonly RuntimeRoleMembership[],
  runtimeRole: string,
  migrationRole: string,
) {
  return memberships.filter((membership) =>
    membership.memberRole === runtimeRole ||
    membership.grantedRole !== runtimeRole ||
    membership.memberRole !== migrationRole
  );
}

export function buildRuntimeGrantStatements(input: Readonly<{
  databaseName: string;
  schemaName: string;
  runtimeRole: string;
  migrationRole: string;
}>) {
  const database = quoteIdentifier(assertSafeIdentifier(input.databaseName));
  const schema = quoteIdentifier(input.schemaName === "public" ? "public" : assertSafeIdentifier(input.schemaName));
  const runtime = quoteIdentifier(assertSafeIdentifier(input.runtimeRole));
  const migration = quoteIdentifier(assertSafeIdentifier(input.migrationRole));
  return Object.freeze([
    `GRANT CONNECT ON DATABASE ${database} TO ${runtime}`,
    `REVOKE CREATE ON DATABASE ${database} FROM ${runtime}`,
    `REVOKE TEMPORARY ON DATABASE ${database} FROM ${runtime}`,
    `REVOKE TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${runtime}`,
    `REVOKE CREATE ON SCHEMA ${schema} FROM ${runtime}`,
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${runtime}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtime}`,
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${runtime}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${runtime}`,
    `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${runtime}`,
    `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC`,
    ...RUNTIME_FUNCTION_ALLOWLIST.map((signature) => {
      const match = /^([a-z0-9_]+)\((.*)\)$/.exec(signature);
      if (!match) throw new Error("Runtime function allowlist entry is invalid");
      return `GRANT EXECUTE ON FUNCTION ${schema}.${quoteIdentifier(match[1])}(${match[2]}) TO ${runtime}`;
    }),
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} REVOKE ALL PRIVILEGES ON TABLES FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} REVOKE ALL PRIVILEGES ON SEQUENCES FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} REVOKE ALL PRIVILEGES ON FUNCTIONS FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA ${schema} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
  ]);
}

export function verifyRuntimeRole<T extends RuntimeRoleCapabilities>(input: T): T {
  if (
    input.superuser || input.createRole || input.createDatabase || input.replication ||
    input.bypassRls || input.schemaCreate || input.canCreateTable || input.canCreateRole ||
    input.canCreateDatabase || input.canAlterTable || input.canDropTable
  ) throw new Error("Database runtime role is not restricted");
  if (input.tableOwnership !== 0 || input.ownedObjects !== 0) {
    throw new Error("Database runtime role has object ownership");
  }
  if (
    input.memberOfRoles !== 0 || input.roleMembers !== 0 ||
    input.nonPublicTableGrants !== 0 || input.unexpectedSchemaPrivileges !== 0 ||
    input.nonPublicSequencePrivileges !== 0 || input.nonPublicFunctionPrivileges !== 0 ||
    input.databaseCreatePrivileges !== 0 || input.databaseTemporaryPrivileges !== 0 ||
    input.otherDatabaseConnectPrivileges !== 0 || input.otherDatabaseTemporaryPrivileges !== 0 ||
    input.unexpectedPublicTablePrivileges !== 0 || input.unexpectedPublicSequencePrivileges !== 0
  ) throw new Error("Database runtime role has unexpected grants or memberships");
  if (!input.currentDatabaseConnect) throw new Error("Database runtime role is missing current database access");
  if (input.missingPublicTablePrivileges !== 0 || input.missingPublicSequencePrivileges !== 0) {
    throw new Error("Database runtime role is missing required grants");
  }
  const actualFunctions = [...input.functionSignatures].sort();
  if (
    input.functionPrivileges !== RUNTIME_FUNCTION_ALLOWLIST.length ||
    JSON.stringify(actualFunctions) !== JSON.stringify(RUNTIME_FUNCTION_ALLOWLIST)
  ) throw new Error("Database runtime role function allowlist is incorrect");
  return input;
}

export function summarizeRuntimeRole(input: RuntimeRoleInventory) {
  return Object.freeze({
    role: input.roleName,
    database: input.database,
    hostFingerprint: input.hostFingerprint,
    attributes: Object.freeze({
      superuser: input.superuser,
      createRole: input.createRole,
      createDatabase: input.createDatabase,
      replication: input.replication,
      bypassRls: input.bypassRls,
    }),
    schemaCreate: input.schemaCreate,
    tableOwnership: input.tableOwnership,
    grants: Object.freeze({
      tables: input.tablePrivileges,
      sequences: input.sequencePrivileges,
      functions: input.functionPrivileges,
    }),
    memberships: Object.freeze({
      memberOfRoles: input.memberOfRoles,
      roleMembers: input.roleMembers,
    }),
    nonPublicTableGrants: input.nonPublicTableGrants,
    ownedObjects: input.ownedObjects,
    unexpectedSchemaPrivileges: input.unexpectedSchemaPrivileges,
    nonPublicSequencePrivileges: input.nonPublicSequencePrivileges,
    nonPublicFunctionPrivileges: input.nonPublicFunctionPrivileges,
    databaseCreatePrivileges: input.databaseCreatePrivileges,
    currentDatabaseConnect: input.currentDatabaseConnect,
    databaseTemporaryPrivileges: input.databaseTemporaryPrivileges,
    otherDatabaseConnectPrivileges: input.otherDatabaseConnectPrivileges,
    otherDatabaseTemporaryPrivileges: input.otherDatabaseTemporaryPrivileges,
    unexpectedPublicTablePrivileges: input.unexpectedPublicTablePrivileges,
    unexpectedPublicSequencePrivileges: input.unexpectedPublicSequencePrivileges,
    missingPublicTablePrivileges: input.missingPublicTablePrivileges,
    missingPublicSequencePrivileges: input.missingPublicSequencePrivileges,
  });
}

export function runtimeInventorySql() {
  return `
    select role.rolsuper as superuser,
           role.rolcreaterole as create_role,
           role.rolcreatedb as create_database,
           role.rolreplication as replication,
           role.rolbypassrls as bypass_rls,
           has_schema_privilege(role.rolname, 'public', 'CREATE') as schema_create,
           (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p') and c.relowner = role.oid) as table_ownership,
           ((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname not in ('pg_catalog','information_schema') and c.relowner = role.oid)
            + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname not in ('pg_catalog','information_schema') and p.proowner = role.oid)
            + (select count(*) from pg_namespace n
              where n.nspname not in ('pg_catalog','information_schema') and n.nspowner = role.oid)
            + (select count(*) from pg_database d where d.datdba = role.oid))::int as owned_objects,
           (select count(*)::int from pg_auth_members m where m.member = role.oid) as member_of_roles,
           (select count(*)::int from pg_auth_members m
             join pg_roles member on member.oid = m.member
            where m.roleid = role.oid and member.rolname <> $2) as role_members,
           (select count(*)::int from pg_database d
             where has_database_privilege(role.rolname, d.oid, 'CREATE')) as database_create_privileges,
           has_database_privilege(role.rolname, current_database(), 'CONNECT') as current_database_connect,
           (select count(*)::int from pg_database d
             where d.datname = current_database()
               and has_database_privilege(role.rolname, d.oid, 'TEMP')) as database_temporary_privileges,
           (select count(*)::int from pg_database d
             where d.datallowconn and d.datname <> current_database()
               and has_database_privilege(role.rolname, d.oid, 'CONNECT')) as other_database_connect_privileges,
           (select count(*)::int from pg_database d
             where d.datallowconn and d.datname <> current_database()
               and has_database_privilege(role.rolname, d.oid, 'TEMP')) as other_database_temporary_privileges,
           (select count(*)::int from pg_namespace n
             where n.nspname <> 'public'
               and n.nspname not in ('pg_catalog','information_schema')
               and n.nspname not like 'pg\_%' escape '\\'
               and (has_schema_privilege(role.rolname, n.oid, 'USAGE')
                 or has_schema_privilege(role.rolname, n.oid, 'CREATE'))) as unexpected_schema_privileges,
           (select count(*)::int from information_schema.role_table_grants g
             where g.grantee = role.rolname and g.table_schema = 'public'
               and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as table_privileges,
           (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
               and (has_table_privilege(role.rolname, c.oid, 'TRUNCATE')
                 or has_table_privilege(role.rolname, c.oid, 'REFERENCES')
                 or has_table_privilege(role.rolname, c.oid, 'TRIGGER'))) as unexpected_public_table_privileges,
           (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
               and not (has_table_privilege(role.rolname, c.oid, 'SELECT')
                 and has_table_privilege(role.rolname, c.oid, 'INSERT')
                 and has_table_privilege(role.rolname, c.oid, 'UPDATE')
                 and has_table_privilege(role.rolname, c.oid, 'DELETE'))) as missing_public_table_privileges,
           (select count(*)::int from information_schema.role_table_grants g
             where g.grantee = role.rolname and g.table_schema <> 'public'
               and g.table_schema not in ('pg_catalog','information_schema')) as non_public_table_grants,
           (select count(*)::int from pg_sequences sequence
             where sequence.schemaname = 'public'
               and has_sequence_privilege(
                 role.rolname,
                 format('%I.%I', sequence.schemaname, sequence.sequencename),
                 'USAGE,SELECT'
               )) as sequence_privileges,
           (select count(*)::int from pg_sequences sequence
             where sequence.schemaname = 'public'
               and has_sequence_privilege(
                 role.rolname,
                 format('%I.%I', sequence.schemaname, sequence.sequencename),
                 'UPDATE'
               )) as unexpected_public_sequence_privileges,
           (select count(*)::int from pg_sequences sequence
             where sequence.schemaname = 'public'
               and not (has_sequence_privilege(
                 role.rolname,
                 format('%I.%I', sequence.schemaname, sequence.sequencename),
                 'USAGE'
               ) and has_sequence_privilege(
                 role.rolname,
                 format('%I.%I', sequence.schemaname, sequence.sequencename),
                 'SELECT'
               ))) as missing_public_sequence_privileges,
           (select count(*)::int from pg_sequences sequence
             where sequence.schemaname <> 'public'
               and sequence.schemaname not in ('pg_catalog','information_schema')
               and has_sequence_privilege(
                 role.rolname,
                 format('%I.%I', sequence.schemaname, sequence.sequencename),
                 'USAGE,SELECT'
               )) as non_public_sequence_privileges,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and has_function_privilege(role.rolname, p.oid, 'EXECUTE')) as function_privileges
           ,(select coalesce(array_agg(
                p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
                order by p.proname, oidvectortypes(p.proargtypes)
              ), array[]::text[])
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and has_function_privilege(role.rolname, p.oid, 'EXECUTE')) as function_signatures,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname <> 'public'
               and n.nspname not in ('pg_catalog','information_schema')
               and n.nspname not like 'pg\_%' escape '\\'
               and has_function_privilege(role.rolname, p.oid, 'EXECUTE')) as non_public_function_privileges
      from pg_roles role
     where role.rolname = $1
  `;
}

function parsePostgresUrl(value: string, variable: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a PostgreSQL URL`);
  }
  if (!url.protocol.startsWith("postgres") || !url.hostname) {
    throw new Error(`${variable} must be a PostgreSQL URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`${variable} must identify a database`);
  return { url: value, database, hostname: url.hostname };
}

async function identify(client: pg.Client, target: ReturnType<typeof parsePostgresUrl>) {
  const result = await client.query<{ database: string; role_name: string; in_recovery: boolean }>(`
    select current_database() as database,
           current_user as role_name,
           pg_is_in_recovery() as in_recovery
  `);
  const row = result.rows[0];
  if (!row || row.database !== target.database || row.in_recovery) {
    throw new Error("Database identity mismatch; runtime role operation refused");
  }
  return row;
}

async function assertMigrationObjectOwnership(client: pg.Client, migrationRole: string) {
  const result = await client.query<{ owner_name: string; object_count: number }>(`
    with owned as (
      select owner.rolname as owner_name, count(*)::int as object_count
        from pg_class object
        join pg_namespace namespace on namespace.oid = object.relnamespace
        join pg_roles owner on owner.oid = object.relowner
       where namespace.nspname = 'public'
       group by owner.rolname
      union all
      select owner.rolname as owner_name, count(*)::int as object_count
        from pg_proc object
        join pg_namespace namespace on namespace.oid = object.pronamespace
        join pg_roles owner on owner.oid = object.proowner
       where namespace.nspname = 'public'
       group by owner.rolname
    )
    select owner_name, sum(object_count)::int as object_count
      from owned
     group by owner_name
  `);
  const unexpected = result.rows.filter((row) => row.owner_name !== migrationRole && row.object_count > 0);
  if (unexpected.length > 0) {
    throw new Error("Public application objects have an unexpected owner; runtime-role change refused");
  }
}

async function assertNoRoleMemberships(client: pg.Client, runtimeRole: string, migrationRole: string) {
  const memberships = await client.query<{
    granted_role: string;
    member_role: string;
  }>(`
    select granted.rolname as granted_role,
           member.rolname as member_role
      from pg_auth_members membership
      join pg_roles member on member.oid = membership.member
      join pg_roles granted on granted.oid = membership.roleid
     where member.rolname = $1 or granted.rolname = $1
  `, [runtimeRole]);
  const unexpected = unexpectedRuntimeRoleMemberships(
    memberships.rows.map((row) => ({ grantedRole: row.granted_role, memberRole: row.member_role })),
    runtimeRole,
    migrationRole,
  );
  if (unexpected.length !== 0) {
    throw new Error("Existing runtime role has role memberships; apply refused");
  }
}

async function readRuntimeRoleAttributes(client: pg.Client, runtimeRole: string) {
  const result = await client.query<{
    can_login: boolean;
    inherit: boolean;
    superuser: boolean;
    create_role: boolean;
    create_database: boolean;
    replication: boolean;
    bypass_rls: boolean;
  }>(`
    select rolcanlogin as can_login,
           rolinherit as inherit,
           rolsuper as superuser,
           rolcreaterole as create_role,
           rolcreatedb as create_database,
           rolreplication as replication,
           rolbypassrls as bypass_rls
      from pg_roles
     where rolname = $1
  `, [runtimeRole]);
  const row = result.rows[0];
  if (!row) throw new Error("Runtime role does not exist; hardening refused");
  return Object.freeze({
    canLogin: row.can_login,
    inherit: row.inherit,
    superuser: row.superuser,
    createRole: row.create_role,
    createDatabase: row.create_database,
    replication: row.replication,
    bypassRls: row.bypass_rls,
  });
}

async function applyMinimumRuntimeGrants(
  client: pg.Client,
  input: Readonly<{ databaseName: string; runtimeRole: string; migrationRole: string }>,
) {
  await assertMigrationObjectOwnership(client, input.migrationRole);
  await assertNoRoleMemberships(client, input.runtimeRole, input.migrationRole);
  for (const statement of buildRuntimeGrantStatements({
    databaseName: input.databaseName,
    schemaName: "public",
    runtimeRole: input.runtimeRole,
    migrationRole: input.migrationRole,
  })) await client.query(statement);
}

export function buildRuntimeRollbackPlan(input: Readonly<{
  databaseName: string;
  runtimeRole: string;
  migrationRole: string;
}>) {
  const database = quoteIdentifier(assertSafeIdentifier(input.databaseName));
  const runtime = quoteIdentifier(assertSafeIdentifier(input.runtimeRole));
  const migration = quoteIdentifier(assertSafeIdentifier(input.migrationRole));
  return Object.freeze([
    "Restore the prior privileged Production database variables from the verified macOS Keychain entry.",
    "Redeploy the recorded known-good main deployment and verify database connectivity.",
    `ALTER ROLE ${runtime} NOLOGIN`,
    `REVOKE CONNECT ON DATABASE ${database} FROM ${runtime}`,
    `REVOKE TEMPORARY ON DATABASE ${database} FROM ${runtime}`,
    `REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM ${runtime}`,
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM ${runtime}`,
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM ${runtime}`,
    `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public" FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA "public" REVOKE ALL PRIVILEGES ON TABLES FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA "public" REVOKE ALL PRIVILEGES ON SEQUENCES FROM ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA "public" REVOKE ALL PRIVILEGES ON FUNCTIONS FROM ${runtime}`,
    "The hardened PUBLIC function and TEMP privileges remain restricted; the migration owner retains inherent access.",
  ]);
}

export async function readRuntimeRoleInventory(
  client: pg.Client,
  input: Readonly<{ roleName: string; migrationRole: string; database: string; hostname: string }>,
): Promise<RuntimeRoleInventory> {
  const roleName = assertSafeIdentifier(input.roleName);
  const migrationRole = assertSafeIdentifier(input.migrationRole);
  const result = await client.query<{
    superuser: boolean;
    create_role: boolean;
    create_database: boolean;
    replication: boolean;
    bypass_rls: boolean;
    schema_create: boolean;
    table_ownership: number;
    table_privileges: number;
    sequence_privileges: number;
    function_privileges: number;
    function_signatures: string[];
    member_of_roles: number;
    role_members: number;
    non_public_table_grants: number;
    owned_objects: number;
    unexpected_schema_privileges: number;
    non_public_sequence_privileges: number;
    non_public_function_privileges: number;
    database_create_privileges: number;
    current_database_connect: boolean;
    database_temporary_privileges: number;
    other_database_connect_privileges: number;
    other_database_temporary_privileges: number;
    unexpected_public_table_privileges: number;
    unexpected_public_sequence_privileges: number;
    missing_public_table_privileges: number;
    missing_public_sequence_privileges: number;
  }>(runtimeInventorySql(), [roleName, migrationRole]);
  const row = result.rows[0];
  if (!row) throw new Error("Database runtime role does not exist");
  return Object.freeze({
    roleName,
    database: input.database,
    hostFingerprint: databaseHostFingerprint(input.hostname),
    superuser: row.superuser,
    createRole: row.create_role,
    createDatabase: row.create_database,
    replication: row.replication,
    bypassRls: row.bypass_rls,
    schemaCreate: row.schema_create,
    tableOwnership: row.table_ownership,
    tablePrivileges: row.table_privileges,
    sequencePrivileges: row.sequence_privileges,
    functionPrivileges: row.function_privileges,
    functionSignatures: Object.freeze([...row.function_signatures]),
    memberOfRoles: row.member_of_roles,
    roleMembers: row.role_members,
    nonPublicTableGrants: row.non_public_table_grants,
    ownedObjects: row.owned_objects,
    unexpectedSchemaPrivileges: row.unexpected_schema_privileges,
    nonPublicSequencePrivileges: row.non_public_sequence_privileges,
    nonPublicFunctionPrivileges: row.non_public_function_privileges,
    databaseCreatePrivileges: row.database_create_privileges,
    currentDatabaseConnect: row.current_database_connect,
    databaseTemporaryPrivileges: row.database_temporary_privileges,
    otherDatabaseConnectPrivileges: row.other_database_connect_privileges,
    otherDatabaseTemporaryPrivileges: row.other_database_temporary_privileges,
    unexpectedPublicTablePrivileges: row.unexpected_public_table_privileges,
    unexpectedPublicSequencePrivileges: row.unexpected_public_sequence_privileges,
    missingPublicTablePrivileges: row.missing_public_table_privileges,
    missingPublicSequencePrivileges: row.missing_public_sequence_privileges,
  });
}

function verifyInventory(inventory: RuntimeRoleInventory) {
  return verifyRuntimeRole({
    ...inventory,
    canCreateTable: inventory.schemaCreate || inventory.databaseTemporaryPrivileges > 0,
    canCreateRole: inventory.createRole,
    canCreateDatabase: inventory.createDatabase,
    canAlterTable: inventory.tableOwnership > 0,
    canDropTable: inventory.tableOwnership > 0,
  });
}

export async function applyRuntimeRole(input: Readonly<{
  adminUrl: string;
  runtimeRole: string;
  runtimePassword: string;
  expectedDatabase: string;
  expectedHostFingerprint: string;
}>) {
  const target = parsePostgresUrl(input.adminUrl, "RNR_DB_ADMIN_URL");
  if (
    target.database !== input.expectedDatabase ||
    databaseHostFingerprint(target.hostname) !== input.expectedHostFingerprint.toLowerCase()
  ) throw new Error("Expected Production database identity does not match connection target");
  if (input.runtimePassword.length < 32) throw new Error("Runtime database password is too short");
  const runtimeRole = assertSafeIdentifier(input.runtimeRole);
  const client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const identity = await identify(client, target);
    const migrationRole = assertSafeIdentifier(identity.role_name);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 30000");
    const exists = await client.query<{ exists: boolean }>("select exists(select 1 from pg_roles where rolname = $1) as exists", [runtimeRole]);
    await client.query("select set_config('rnr.runtime_password', $1, true)", [input.runtimePassword]);
    if (!exists.rows[0]?.exists) {
      await client.query(`
        do $rnr$
        begin
          execute format(
            'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
            ${quoteLiteral(runtimeRole)},
            current_setting('rnr.runtime_password')
          );
        end
        $rnr$
      `);
    } else {
      await assertNoRoleMemberships(client, runtimeRole, migrationRole);
      await client.query(`
        do $rnr$
        begin
          execute format(
            'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
            ${quoteLiteral(runtimeRole)},
            current_setting('rnr.runtime_password')
          );
        end
        $rnr$
      `);
    }
    await applyMinimumRuntimeGrants(client, {
      databaseName: target.database,
      runtimeRole,
      migrationRole,
    });
    const inventory = await readRuntimeRoleInventory(client, {
      roleName: runtimeRole,
      migrationRole,
      database: target.database,
      hostname: target.hostname,
    });
    verifyInventory(inventory);
    await client.query("COMMIT");
    return inventory;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function hardenExistingRuntimeRole(input: Readonly<{
  adminUrl: string;
  runtimeRole: string;
  expectedDatabase: string;
  expectedHostFingerprint: string;
}>) {
  const target = parsePostgresUrl(input.adminUrl, "RNR_DB_ADMIN_URL");
  if (
    target.database !== input.expectedDatabase ||
    databaseHostFingerprint(target.hostname) !== input.expectedHostFingerprint.toLowerCase()
  ) throw new Error("Expected Production database identity does not match connection target");
  const runtimeRole = assertSafeIdentifier(input.runtimeRole);
  const client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const identity = await identify(client, target);
    const migrationRole = assertSafeIdentifier(identity.role_name);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 30000");
    const beforeAttributes = await readRuntimeRoleAttributes(client, runtimeRole);
    if (!runtimeRoleAttributesAreSafe(beforeAttributes)) {
      await client.query(`ALTER ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    }
    const afterAttributes = await readRuntimeRoleAttributes(client, runtimeRole);
    if (!runtimeRoleAttributesAreSafe(afterAttributes)) {
      throw new Error("Database runtime role attributes remain unsafe; hardening refused");
    }
    await applyMinimumRuntimeGrants(client, {
      databaseName: target.database,
      runtimeRole,
      migrationRole,
    });
    const inventory = await readRuntimeRoleInventory(client, {
      roleName: runtimeRole,
      migrationRole,
      database: target.database,
      hostname: target.hostname,
    });
    verifyInventory(inventory);
    await client.query("COMMIT");
    return inventory;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  if (process.argv.includes("--rollback-plan")) {
    process.stdout.write(`${JSON.stringify(buildRuntimeRollbackPlan({
      databaseName: argument("--expected-database"),
      runtimeRole: argument("--runtime-role"),
      migrationRole: argument("--migration-role"),
    }))}\n`);
    return;
  }
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Explicit --confirm-production is required");
  }
  const common = {
    adminUrl: process.env.RNR_DB_ADMIN_URL?.trim() || "",
    runtimeRole: argument("--runtime-role"),
    expectedDatabase: argument("--expected-database"),
    expectedHostFingerprint: argument("--expected-host-fingerprint"),
  };
  const inventory = process.argv.includes("--harden-existing")
    ? await hardenExistingRuntimeRole(common)
    : process.argv.includes("--apply")
      ? await applyRuntimeRole({
          ...common,
          runtimePassword: process.env.RNR_DB_RUNTIME_PASSWORD?.trim() || "",
        })
      : (() => { throw new Error("Explicit --apply or --harden-existing is required"); })();
  verifyInventory(inventory);
  process.stdout.write(`${JSON.stringify(summarizeRuntimeRole(inventory))}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Database runtime role operation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
