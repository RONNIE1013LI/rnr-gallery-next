import { describe, expect, it } from "vitest";
import * as productionGuard from "./production-guard";
import {
  assertReadOnlyGuardRequest,
  classifyMigrationLineage,
  evaluateProductionGuard,
  type ProductionGuardSnapshot,
} from "./production-guard";

const sha = "a".repeat(40);

function validSnapshot(): ProductionGuardSnapshot {
  return {
    originMainSha: sha,
    github: {
      repository: "RONNIE1013LI/rnr-gallery-next",
      forcePushAllowed: false,
      deletionAllowed: false,
      linearHistoryRequired: true,
    },
    project: {
      id: "prj_6HHmxCsLMm8oTwUhMWkpphH7rBlO",
      name: "rnr-gallery-staging",
      productionBranch: "main",
    },
    productionDeployment: {
      id: "dpl_current",
      branch: "main",
      sha,
      createdAt: "2026-08-31T00:00:00.000Z",
      aliases: [
        "rnrgallery.com",
        "www.rnrgallery.com",
        "rrgallery.co.nz",
        "www.rrgallery.co.nz",
      ],
    },
    recentProductionDeployments: [{
      id: "dpl_current",
      branch: "main",
      sha,
      createdAt: "2026-08-31T00:00:00.000Z",
    }],
    domains: [
      { name: "rnrgallery.com", verified: true, misconfigured: false, sslValid: true },
      { name: "www.rnrgallery.com", verified: true, misconfigured: false, sslValid: true },
      { name: "rrgallery.co.nz", verified: true, misconfigured: false, sslValid: true },
      { name: "www.rrgallery.co.nz", verified: true, misconfigured: false, sslValid: true },
    ],
    environmentVariables: [
      { id: "prod-db", key: "DATABASE_URL", targets: ["production"] },
      { id: "preview-db", key: "DATABASE_URL", targets: ["preview"] },
      { id: "dev-db", key: "DATABASE_URL", targets: ["development"] },
      { id: "prod-return", key: "PAYMENT_RETURN_BASE_URL", targets: ["production"] },
      { id: "preview-return", key: "PAYMENT_RETURN_BASE_URL", targets: ["preview"] },
    ],
    databaseFingerprints: {
      production: "1".repeat(64),
      preview: "2".repeat(64),
      development: "3".repeat(64),
      test: "4".repeat(64),
    },
    databaseEnvironmentMetadata: {
      actual: "5".repeat(64),
      expected: "5".repeat(64),
    },
    migration: {
      status: "MATCH",
      localCount: 62,
      appliedCount: 62,
      lastLocalTimestamp: "1788100000000",
      lastAppliedTimestamp: "1788100000000",
    },
  };
}

describe("Production guard invariants", () => {
  it("passes a fully aligned main Production snapshot", () => {
    const result = evaluateProductionGuard(validSnapshot());

    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it.each([
    ["project Production Branch", (snapshot: ProductionGuardSnapshot) => {
      snapshot.project.productionBranch = "feat/unsafe";
    }, "VERCEL_PRODUCTION_BRANCH_NOT_MAIN"],
    ["current deployment branch", (snapshot: ProductionGuardSnapshot) => {
      snapshot.productionDeployment.branch = "feat/unsafe";
    }, "CURRENT_PRODUCTION_NOT_MAIN"],
    ["current deployment SHA", (snapshot: ProductionGuardSnapshot) => {
      snapshot.productionDeployment.sha = "b".repeat(40);
    }, "PRODUCTION_SHA_MISMATCH"],
    ["Production aliases", (snapshot: ProductionGuardSnapshot) => {
      snapshot.productionDeployment.aliases = ["rnrgallery.com"];
    }, "PRODUCTION_ALIAS_MISSING"],
  ])("fails when %s drifts", (_label, mutate, expectedCode) => {
    const snapshot = validSnapshot();
    mutate(snapshot);

    const result = evaluateProductionGuard(snapshot);

    expect(result.passed).toBe(false);
    expect(result.findings.map(({ code }) => code)).toContain(expectedCode);
  });

  it("detects a recent non-main Production deployment", () => {
    const snapshot = validSnapshot();
    snapshot.recentProductionDeployments.push({
      id: "dpl_unsafe",
      branch: "feat/unsafe",
      sha: "b".repeat(40),
      createdAt: "2026-08-30T00:00:00.000Z",
    });

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "NON_MAIN_PRODUCTION_DEPLOYMENT",
      subject: "dpl_unsafe",
    }));
  });

  it("detects unverified, misconfigured, or invalid-SSL domains", () => {
    const snapshot = validSnapshot();
    snapshot.domains[0].verified = false;
    snapshot.domains[1].misconfigured = true;
    snapshot.domains[2].sslValid = false;

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "DOMAIN_NOT_VERIFIED",
      "DOMAIN_MISCONFIGURED",
      "DOMAIN_SSL_INVALID",
    ]));
  });

  it("detects duplicate critical variables in the same scope without values", () => {
    const snapshot = validSnapshot();
    snapshot.environmentVariables.push({
      id: "preview-return-duplicate",
      key: "PAYMENT_RETURN_BASE_URL",
      targets: ["preview"],
    });

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_CRITICAL_ENV",
      subject: "PAYMENT_RETURN_BASE_URL:preview",
    }));
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it.each([
    "BETTER_AUTH_SECRET",
    "CRON_SECRET",
    "CUSTOMER_NOTIFICATION_CRON_SECRET",
    "MAINTENANCE_CRON_SECRET",
    "PAYMENT_RECONCILIATION_SECRET",
    "META_CAPI_ACCESS_TOKEN",
    "OPENAI_API_KEY",
  ])("detects duplicate %s definitions", (key) => {
    const snapshot = validSnapshot();
    snapshot.environmentVariables.push(
      { id: `${key}-1`, key, targets: ["production"] },
      { id: `${key}-2`, key, targets: ["production"] },
    );

    expect(evaluateProductionGuard(snapshot).findings).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_CRITICAL_ENV",
        subject: `${key}:production`,
      }),
    );
  });

  it("detects Production database credentials shared into Preview or Development", () => {
    const snapshot = validSnapshot();
    snapshot.environmentVariables[0].targets = ["production", "preview", "development"];

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings.map(({ code }) => code)).toContain(
      "PRODUCTION_DATABASE_SCOPE_SHARED",
    );
  });

  it("treats provider-specific database URLs as critical credentials", () => {
    const snapshot = validSnapshot();
    snapshot.environmentVariables.push({
      id: "shared-provider-db",
      key: "POSTGRES_URL",
      targets: ["production", "preview"],
    });

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings.map(({ code }) => code)).toContain(
      "PRODUCTION_DATABASE_SCOPE_SHARED",
    );
  });

  it("fails closed when database environment fingerprints are absent or equal", () => {
    const missing = validSnapshot();
    missing.databaseFingerprints.preview = undefined;
    const equal = validSnapshot();
    equal.databaseFingerprints.development = equal.databaseFingerprints.production;

    expect(evaluateProductionGuard(missing).findings.map(({ code }) => code)).toContain(
      "DATABASE_ISOLATION_UNPROVEN",
    );
    expect(evaluateProductionGuard(equal).findings.map(({ code }) => code)).toContain(
      "DATABASE_TARGET_REUSED",
    );
  });

  it("treats uppercase and lowercase target fingerprints as the same database", () => {
    const snapshot = validSnapshot();
    snapshot.databaseFingerprints.production = "a".repeat(64);
    snapshot.databaseFingerprints.development = "A".repeat(64);

    expect(evaluateProductionGuard(snapshot).findings.map(({ code }) => code)).toContain(
      "DATABASE_TARGET_REUSED",
    );
  });

  it("fails when Vercel database environment metadata changes after certification", () => {
    const snapshot = validSnapshot() as ProductionGuardSnapshot & {
      databaseEnvironmentMetadata: { actual: string; expected: string };
    };
    snapshot.databaseEnvironmentMetadata = {
      actual: "a".repeat(64),
      expected: "b".repeat(64),
    };

    expect(evaluateProductionGuard(snapshot).findings.map(({ code }) => code)).toContain(
      "DATABASE_ENV_METADATA_CHANGED",
    );
  });

  it("fails when main protection or migration lineage is not safe", () => {
    const snapshot = validSnapshot();
    snapshot.github.forcePushAllowed = true;
    snapshot.github.deletionAllowed = true;
    snapshot.migration.status = "JOURNAL_HASH_MISMATCH";

    const result = evaluateProductionGuard(snapshot);

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MAIN_FORCE_PUSH_ALLOWED",
      "MAIN_DELETION_ALLOWED",
      "MIGRATION_DRIFT",
    ]));
  });
});

describe("migration lineage classification", () => {
  const local = [
    { position: 0, hash: "a".repeat(64), createdAt: "100" },
    { position: 1, hash: "b".repeat(64), createdAt: "200" },
  ];

  it("classifies exact, unapplied, hash-mismatched, and unknown histories", () => {
    expect(classifyMigrationLineage(local, local).status).toBe("MATCH");
    expect(classifyMigrationLineage(local, local.slice(0, 1)).status).toBe("NOT_APPLIED");
    expect(classifyMigrationLineage(local, [
      local[0],
      { ...local[1], hash: "c".repeat(64) },
    ]).status).toBe("JOURNAL_HASH_MISMATCH");
    expect(classifyMigrationLineage(local.slice(0, 1), local).status).toBe("UNKNOWN");
  });
});

describe("Production guard network boundary", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects Vercel %s requests before they can reach the API",
    (method) => {
      expect(() => assertReadOnlyGuardRequest(
        "https://api.vercel.com/v9/projects/project-id",
        { method },
      )).toThrow(/GET or HEAD/i);
    },
  );

  it("allows only HTTPS GET/HEAD requests to the guard host allowlist", () => {
    expect(assertReadOnlyGuardRequest(
      "https://api.vercel.com/v9/projects/project-id",
      { method: "GET" },
    )).toBe("GET");
    expect(assertReadOnlyGuardRequest(
      "https://rnrgallery.com/",
      { method: "HEAD" },
    )).toBe("HEAD");
    expect(() => assertReadOnlyGuardRequest(
      "https://example.com/",
      { method: "GET" },
    )).toThrow(/host allowlist/i);
    expect(() => assertReadOnlyGuardRequest(
      "http://api.vercel.com/v9/projects/project-id",
      { method: "GET" },
    )).toThrow(/HTTPS/i);
  });
});

describe("Vercel Production adapter", () => {
  it("uses the project Production target because deployment listings omit aliases", () => {
    const parseCurrentProductionDeployment = (
      productionGuard as Record<string, unknown>
    ).parseCurrentProductionDeployment;

    expect(parseCurrentProductionDeployment).toBeTypeOf("function");
    expect((parseCurrentProductionDeployment as (value: unknown) => unknown)({
      targets: {
        production: {
          id: "dpl_current",
          alias: [
            "rnrgallery.com",
            "www.rnrgallery.com",
            "rrgallery.co.nz",
            "www.rrgallery.co.nz",
          ],
          createdAt: 1_788_130_000_000,
          readyState: "READY",
          meta: {
            githubCommitRef: "main",
            githubCommitSha: "a".repeat(40),
          },
        },
      },
    })).toEqual(expect.objectContaining({
      id: "dpl_current",
      branch: "main",
      sha: "a".repeat(40),
      aliases: [
        "rnrgallery.com",
        "www.rnrgallery.com",
        "rrgallery.co.nz",
        "www.rrgallery.co.nz",
      ],
      ready: true,
    }));
  });

  it("takes misconfiguration status from the dedicated domain config response", () => {
    const parseDomainState = (
      productionGuard as Record<string, unknown>
    ).parseDomainState;

    expect(parseDomainState).toBeTypeOf("function");
    expect((parseDomainState as (
      projectDomain: unknown,
      domainConfig: unknown,
      sslValid: boolean,
    ) => unknown)(
      { name: "rnrgallery.com", verified: true },
      { misconfigured: false },
      true,
    )).toEqual({
      name: "rnrgallery.com",
      verified: true,
      misconfigured: false,
      sslValid: true,
    });
    expect((parseDomainState as (
      projectDomain: unknown,
      domainConfig: unknown,
      sslValid: boolean,
    ) => { misconfigured: boolean })(
      { name: "rnrgallery.com", verified: true },
      {},
      true,
    ).misconfigured).toBe(true);
  });

  it("fingerprints database environment metadata without reading values", () => {
    const databaseEnvironmentMetadataFingerprint = (
      productionGuard as Record<string, unknown>
    ).databaseEnvironmentMetadataFingerprint;
    const first = [
      {
        id: "preview-db",
        key: "DATABASE_URL",
        targets: ["preview"],
        type: "sensitive",
        updatedAt: "1788130637294",
      },
      {
        id: "unrelated",
        key: "NEXT_PUBLIC_SITE_URL",
        targets: ["production"],
        type: "plain",
        updatedAt: "1",
      },
    ];

    expect(databaseEnvironmentMetadataFingerprint).toBeTypeOf("function");
    const fingerprint = databaseEnvironmentMetadataFingerprint as (
      variables: unknown[],
    ) => string;
    expect(fingerprint(first)).toBe(fingerprint([...first].reverse()));
    expect(fingerprint(first)).not.toBe(fingerprint([
      { ...first[0], updatedAt: "1788130638000" },
      first[1],
    ]));
  });
});
