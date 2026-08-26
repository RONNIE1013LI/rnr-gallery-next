import { describe, expect, it } from "vitest";
import {
  assertSafeIdentifier,
  buildRuntimeRollbackPlan,
  buildRuntimeGrantStatements,
  RUNTIME_FUNCTION_ALLOWLIST,
  runtimeInventorySql,
  runtimeRoleAttributesAreSafe,
  unexpectedRuntimeRoleMemberships,
  summarizeRuntimeRole,
  verifyRuntimeRole,
} from "./database-runtime-role-security";

describe("Production database runtime role security", () => {
  it("accepts only conservative PostgreSQL identifiers", () => {
    expect(assertSafeIdentifier("rnr_app_runtime")).toBe("rnr_app_runtime");
    expect(() => assertSafeIdentifier("runtime; drop role admin")).toThrow(/identifier/i);
    expect(() => assertSafeIdentifier("UPPERCASE")).toThrow(/identifier/i);
    expect(() => assertSafeIdentifier("pg_runtime")).toThrow(/reserved/i);
  });

  it("generates minimum current and future-object grants without broad function execution", () => {
    const statements = buildRuntimeGrantStatements({
      databaseName: "neondb",
      schemaName: "public",
      runtimeRole: "rnr_app_runtime",
      migrationRole: "neondb_owner",
    });
    const sql = statements.join("\n");
    expect(sql).toContain('GRANT CONNECT ON DATABASE "neondb" TO "rnr_app_runtime"');
    expect(sql).toContain('REVOKE TEMPORARY ON DATABASE "neondb" FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "rnr_app_runtime"');
    expect(sql).toContain('GRANT USAGE ON SCHEMA "public" TO "rnr_app_runtime"');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "rnr_app_runtime"');
    expect(sql).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "rnr_app_runtime"');
    expect(sql).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "public" FROM "rnr_app_runtime"');
    expect(sql).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA "public" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA "public" REVOKE ALL PRIVILEGES ON TABLES FROM "rnr_app_runtime"');
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA "public" REVOKE ALL PRIVILEGES ON SEQUENCES FROM "rnr_app_runtime"');
    for (const signature of RUNTIME_FUNCTION_ALLOWLIST) {
      const [name, argumentsList] = signature.slice(0, -1).split("(");
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION "public"."' + name + '"(' + argumentsList + ') TO "rnr_app_runtime"',
      );
    }
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA "public"');
    expect(sql).toContain('REVOKE CREATE ON DATABASE "neondb" FROM "rnr_app_runtime"');
    expect(sql).toContain('REVOKE CREATE ON SCHEMA "public" FROM "rnr_app_runtime"');
    expect(sql).not.toMatch(/GRANT EXECUTE ON ALL|OWNER TO|DROP ROLE|DROP TABLE|ALTER TABLE/i);
  });

  it("fails closed when any forbidden role or DDL capability remains", () => {
    const safe = {
      superuser: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      bypassRls: false,
      schemaCreate: false,
      tableOwnership: 0,
      canCreateTable: false,
      canCreateRole: false,
      canCreateDatabase: false,
      canAlterTable: false,
      canDropTable: false,
      memberOfRoles: 0,
      roleMembers: 0,
      nonPublicTableGrants: 0,
      ownedObjects: 0,
      functionPrivileges: RUNTIME_FUNCTION_ALLOWLIST.length,
      functionSignatures: RUNTIME_FUNCTION_ALLOWLIST,
      unexpectedSchemaPrivileges: 0,
      nonPublicSequencePrivileges: 0,
      nonPublicFunctionPrivileges: 0,
      databaseCreatePrivileges: 0,
      currentDatabaseConnect: true,
      databaseTemporaryPrivileges: 0,
      otherDatabaseConnectPrivileges: 0,
      otherDatabaseTemporaryPrivileges: 0,
      unexpectedPublicTablePrivileges: 0,
      unexpectedPublicSequencePrivileges: 0,
      missingPublicTablePrivileges: 0,
      missingPublicSequencePrivileges: 0,
    };
    expect(verifyRuntimeRole(safe)).toEqual(safe);
    for (const key of [
      "superuser",
      "createRole",
      "createDatabase",
      "replication",
      "bypassRls",
      "schemaCreate",
      "canCreateTable",
      "canCreateRole",
      "canCreateDatabase",
      "canAlterTable",
      "canDropTable",
    ] as const) {
      expect(() => verifyRuntimeRole({ ...safe, [key]: true })).toThrow(/restricted/i);
    }
    expect(() => verifyRuntimeRole({ ...safe, tableOwnership: 1 })).toThrow(/ownership/i);
    expect(() => verifyRuntimeRole({ ...safe, databaseTemporaryPrivileges: 1 })).toThrow(/unexpected grants/i);
    expect(() => verifyRuntimeRole({ ...safe, otherDatabaseConnectPrivileges: 1 })).toThrow(/unexpected grants/i);
    expect(() => verifyRuntimeRole({ ...safe, unexpectedPublicTablePrivileges: 1 })).toThrow(/unexpected grants/i);
    expect(() => verifyRuntimeRole({ ...safe, unexpectedPublicSequencePrivileges: 1 })).toThrow(/unexpected grants/i);
    expect(() => verifyRuntimeRole({ ...safe, missingPublicTablePrivileges: 1 })).toThrow(/missing required grants/i);
    expect(() => verifyRuntimeRole({
      ...safe,
      functionSignatures: [...RUNTIME_FUNCTION_ALLOWLIST, "unsafe_admin_function()"],
      functionPrivileges: RUNTIME_FUNCTION_ALLOWLIST.length + 1,
    })).toThrow(/allowlist/i);
  });

  it("prints only non-secret boolean/count evidence", () => {
    const summary = summarizeRuntimeRole({
      roleName: "rnr_app_runtime",
      database: "neondb",
      hostFingerprint: "a".repeat(64),
      superuser: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      bypassRls: false,
      schemaCreate: false,
      tableOwnership: 0,
      tablePrivileges: 296,
      sequencePrivileges: 2,
      functionPrivileges: 6,
      functionSignatures: RUNTIME_FUNCTION_ALLOWLIST,
      unexpectedSchemaPrivileges: 0,
      nonPublicSequencePrivileges: 0,
      nonPublicFunctionPrivileges: 0,
      databaseCreatePrivileges: 0,
      currentDatabaseConnect: true,
      databaseTemporaryPrivileges: 0,
      otherDatabaseConnectPrivileges: 0,
      otherDatabaseTemporaryPrivileges: 0,
      unexpectedPublicTablePrivileges: 0,
      unexpectedPublicSequencePrivileges: 0,
      missingPublicTablePrivileges: 0,
      missingPublicSequencePrivileges: 0,
      memberOfRoles: 0,
      roleMembers: 0,
      nonPublicTableGrants: 0,
      ownedObjects: 0,
    });
    expect(summary).toEqual({
      role: "rnr_app_runtime",
      database: "neondb",
      hostFingerprint: "a".repeat(64),
      attributes: {
        superuser: false,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRls: false,
      },
      schemaCreate: false,
      tableOwnership: 0,
      grants: { tables: 296, sequences: 2, functions: 6 },
      memberships: { memberOfRoles: 0, roleMembers: 0 },
      nonPublicTableGrants: 0,
      ownedObjects: 0,
      unexpectedSchemaPrivileges: 0,
      nonPublicSequencePrivileges: 0,
      nonPublicFunctionPrivileges: 0,
      databaseCreatePrivileges: 0,
      currentDatabaseConnect: true,
      databaseTemporaryPrivileges: 0,
      otherDatabaseConnectPrivileges: 0,
      otherDatabaseTemporaryPrivileges: 0,
      unexpectedPublicTablePrivileges: 0,
      unexpectedPublicSequencePrivileges: 0,
      missingPublicTablePrivileges: 0,
      missingPublicSequencePrivileges: 0,
    });
    expect(JSON.stringify(summary)).not.toMatch(/password|connection|url|secret/i);
  });

  it("generates a secret-free, non-destructive runtime rollback sequence", () => {
    const plan = buildRuntimeRollbackPlan({
      databaseName: "neondb",
      runtimeRole: "rnr_app_runtime",
      migrationRole: "neondb_owner",
    });
    const text = plan.join("\n");
    expect(text).toContain("verified macOS Keychain entry");
    expect(text).toContain('ALTER ROLE "rnr_app_runtime" NOLOGIN');
    expect(text).toContain('REVOKE CONNECT ON DATABASE "neondb"');
    expect(text).toContain('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public"');
    expect(text).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner"');
    expect(text).not.toMatch(/PASSWORD|DROP ROLE|connection string|postgresql:\/\//i);
  });

  it("queries only sequence catalog rows before calling has_sequence_privilege", () => {
    const sql = runtimeInventorySql();
    expect(sql).toMatch(/from pg_sequences/i);
    expect(sql).not.toMatch(/pg_class c[\s\S]*c\.relkind = 'S'[\s\S]*has_sequence_privilege/i);
    expect(sql).toMatch(/pg_auth_members/i);
    expect(sql).toMatch(/n\.nspname not in \('pg_catalog','information_schema'\)/i);
    expect(sql).toMatch(/pg_proc/i);
    expect(sql).toMatch(/has_table_privilege[\s\S]*'TRUNCATE'[\s\S]*has_table_privilege[\s\S]*'REFERENCES'[\s\S]*has_table_privilege[\s\S]*'TRIGGER'/i);
    expect(sql).toMatch(/has_sequence_privilege[\s\S]*UPDATE/i);
    expect(sql).toMatch(/has_database_privilege[\s\S]*TEMP/i);
    expect(sql).toMatch(/d\.datname <> current_database\(\)/i);
  });

  it("skips a redundant ALTER ROLE only when every runtime attribute is already safe", () => {
    const safe = {
      canLogin: true,
      inherit: false,
      superuser: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      bypassRls: false,
    };

    expect(runtimeRoleAttributesAreSafe(safe)).toBe(true);
    for (const [key, value] of [
      ["canLogin", false],
      ["inherit", true],
      ["superuser", true],
      ["createRole", true],
      ["createDatabase", true],
      ["replication", true],
      ["bypassRls", true],
    ] as const) {
      expect(runtimeRoleAttributesAreSafe({ ...safe, [key]: value })).toBe(false);
    }
  });

  it("allows only the expected migration role to be a member of the runtime role", () => {
    const providerManagedMembership = {
      grantedRole: "rnr_app_runtime",
      memberRole: "neondb_owner",
    };
    expect(unexpectedRuntimeRoleMemberships(
      [providerManagedMembership],
      "rnr_app_runtime",
      "neondb_owner",
    )).toEqual([]);

    expect(unexpectedRuntimeRoleMemberships([
      { grantedRole: "neon_superuser", memberRole: "rnr_app_runtime" },
      providerManagedMembership,
      { grantedRole: "rnr_app_runtime", memberRole: "unexpected_user" },
    ], "rnr_app_runtime", "neondb_owner")).toEqual([
      { grantedRole: "neon_superuser", memberRole: "rnr_app_runtime" },
      { grantedRole: "rnr_app_runtime", memberRole: "unexpected_user" },
    ]);
  });
});
