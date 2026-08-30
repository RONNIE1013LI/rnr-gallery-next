import { describe, expect, it } from "vitest";
import {
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
      production: "prod-fingerprint",
      preview: "preview-fingerprint",
      development: "dev-fingerprint",
      test: "test-fingerprint",
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
