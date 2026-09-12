import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  readAppliedMigrationLineage,
  readLocalMigrationLineage,
  type MigrationLineageEntry,
} from "./migration-lineage";
import { identifyDatabase } from "./migrate-database";
import {
  verifyDatabaseIdentity,
} from "./migration-safety";

const execFile = promisify(execFileCallback);

export const EXPECTED_GITHUB_REPOSITORY = "RONNIE1013LI/rnr-gallery-next";
export const EXPECTED_VERCEL_PROJECT_ID = "prj_6HHmxCsLMm8oTwUhMWkpphH7rBlO";
export const EXPECTED_VERCEL_PROJECT_NAME = "rnr-gallery-staging";
export const EXPECTED_STAGING_DOMAIN = "staging.rnrgallery.com";
export const EXPECTED_STAGING_BRANCH = "codex/invoice-email-release-20260912";
export const EXPECTED_PREVIEW_DATABASE_ENV_ID = "7X3hipGyZA6v6xEA";
export const EXPECTED_PREVIEW_DATABASE_TARGET_FINGERPRINT =
  "a6a953b4a05ac513468276f6d0283cc7dffc59554f0aa415dd8fded304a30bb3";
export const EXPECTED_PRODUCTION_DOMAINS = Object.freeze([
  "rnrgallery.com",
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);
const READ_ONLY_GUARD_HOSTS = new Set([
  "api.github.com",
  "api.vercel.com",
  ...EXPECTED_PRODUCTION_DOMAINS,
]);

type EnvironmentTarget = "production" | "preview" | "development";

export type ProductionGuardEnvironmentVariable = {
  id: string;
  key: string;
  targets: EnvironmentTarget[];
  gitBranch?: string;
  type?: string;
  updatedAt?: string;
};

export type MigrationAuditStatus =
  | "MATCH"
  | "NOT_APPLIED"
  | "SCHEMA_APPLIED_BUT_JOURNAL_MISSING"
  | "PARTIALLY_APPLIED"
  | "JOURNAL_HASH_MISMATCH"
  | "UNKNOWN";

export type MigrationAudit = {
  status: MigrationAuditStatus;
  localCount: number;
  appliedCount: number;
  lastLocalTimestamp?: string;
  lastAppliedTimestamp?: string;
};

export type StagingIsolationSnapshot = {
  domain: {
    name: string;
    projectId: string | undefined;
    gitBranch: string | undefined;
    verified: boolean;
  };
  alias: {
    name: string;
    projectId: string | undefined;
    deploymentId: string | undefined;
  };
  deployment: {
    id: string;
    projectId: string | undefined;
    branch: string | undefined;
    ready: boolean;
    target: "production" | "staging" | null | undefined;
    customEnvironmentPresent?: boolean;
    customEnvironmentType?: "production" | "preview" | "development";
  };
  productionDeploymentId: string;
  previewDatabaseEnvironment: ProductionGuardEnvironmentVariable | undefined;
  branchScopedDatabaseOverrides: Array<Pick<
    ProductionGuardEnvironmentVariable,
    "id" | "key"
  >>;
  databaseFingerprints: {
    production: string | undefined;
    preview: string | undefined;
  };
  databaseEnvironmentMetadata: {
    actual: string | undefined;
    expected: string | undefined;
  };
};

export type ProductionGuardSnapshot = {
  originMainSha: string;
  github: {
    repository: string;
    forcePushAllowed: boolean;
    deletionAllowed: boolean;
    linearHistoryRequired: boolean;
  };
  project: {
    id: string;
    name: string;
    productionBranch: string | undefined;
  };
  productionDeployment: {
    id: string;
    branch: string | undefined;
    sha: string | undefined;
    createdAt: string;
    aliases: string[];
  };
  recentProductionDeployments: Array<{
    id: string;
    branch: string | undefined;
    sha: string | undefined;
    createdAt: string;
  }>;
  domains: Array<{
    name: string;
    verified: boolean;
    misconfigured: boolean;
    sslValid: boolean;
  }>;
  environmentVariables: ProductionGuardEnvironmentVariable[];
  databaseFingerprints: {
    production: string | undefined;
    preview: string | undefined;
    development: string | undefined;
    test: string | undefined;
  };
  databaseEnvironmentMetadata: {
    actual: string | undefined;
    expected: string | undefined;
  };
  stagingIsolation: StagingIsolationSnapshot;
  migration: MigrationAudit;
};

export type ProductionGuardFinding = Readonly<{
  code: string;
  subject: string;
  message: string;
}>;

export type ProductionGuardResult = Readonly<{
  passed: boolean;
  findings: readonly ProductionGuardFinding[];
}>;

function finding(code: string, subject: string, message: string): ProductionGuardFinding {
  return Object.freeze({ code, subject, message });
}

function normalizedSha256(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

export function evaluateStagingIsolation(
  snapshot: StagingIsolationSnapshot,
): ProductionGuardResult {
  const findings: ProductionGuardFinding[] = [];
  const add = (code: string, subject: string, message: string) => {
    findings.push(finding(code, subject, message));
  };

  if (snapshot.domain.name !== EXPECTED_STAGING_DOMAIN) {
    add("STAGING_DOMAIN_MISMATCH", snapshot.domain.name, "Unexpected Staging domain");
  }
  if (!snapshot.domain.verified) {
    add("STAGING_DOMAIN_UNVERIFIED", snapshot.domain.name, "Staging domain is not verified");
  }
  if (snapshot.domain.gitBranch !== EXPECTED_STAGING_BRANCH) {
    add(
      "STAGING_BRANCH_UNPINNED",
      snapshot.domain.gitBranch ?? "UNSET",
      "Staging domain is not pinned to the certified branch",
    );
  }
  for (const [source, projectId] of [
    ["domain", snapshot.domain.projectId],
    ["alias", snapshot.alias.projectId],
    ["deployment", snapshot.deployment.projectId],
  ] as const) {
    if (projectId !== EXPECTED_VERCEL_PROJECT_ID) {
      add(
        "STAGING_PROJECT_MISMATCH",
        `${source}:${projectId ?? "UNKNOWN"}`,
        "Staging identity does not belong to the governed Vercel project",
      );
    }
  }
  if (snapshot.alias.name !== EXPECTED_STAGING_DOMAIN) {
    add("STAGING_ALIAS_MISMATCH", snapshot.alias.name, "Unexpected Staging alias");
  }
  if (
    !snapshot.alias.deploymentId
    || snapshot.alias.deploymentId !== snapshot.deployment.id
  ) {
    add(
      "STAGING_ALIAS_DEPLOYMENT_MISMATCH",
      snapshot.alias.deploymentId ?? "UNKNOWN",
      "Staging alias does not resolve to the inspected deployment",
    );
  }
  if (!snapshot.deployment.ready) {
    add(
      "STAGING_DEPLOYMENT_NOT_READY",
      snapshot.deployment.id,
      "Staging deployment is not READY",
    );
  }
  if (
    snapshot.deployment.target !== null
    || (
      snapshot.deployment.customEnvironmentPresent === true
      && snapshot.deployment.customEnvironmentType !== "preview"
    )
  ) {
    add(
      "STAGING_DEPLOYMENT_NOT_PREVIEW",
      snapshot.deployment.id,
      "Staging alias is not backed by a Preview deployment environment",
    );
  }
  if (snapshot.deployment.branch !== EXPECTED_STAGING_BRANCH) {
    add(
      "STAGING_DEPLOYMENT_BRANCH_MISMATCH",
      snapshot.deployment.branch ?? "UNKNOWN",
      "Staging deployment did not originate from the certified branch",
    );
  }
  if (snapshot.deployment.id === snapshot.productionDeploymentId) {
    add(
      "STAGING_REUSES_PRODUCTION_DEPLOYMENT",
      snapshot.deployment.id,
      "Staging and Production resolve to the same deployment",
    );
  }
  if (snapshot.productionDeploymentId === "UNKNOWN") {
    add(
      "STAGING_PRODUCTION_IDENTITY_UNKNOWN",
      "Production",
      "Current Production deployment identity is unavailable",
    );
  }

  const previewDatabaseEnvironment = snapshot.previewDatabaseEnvironment;
  if (
    previewDatabaseEnvironment?.id !== EXPECTED_PREVIEW_DATABASE_ENV_ID
    || previewDatabaseEnvironment.key !== "DATABASE_URL"
    || previewDatabaseEnvironment.gitBranch !== undefined
    || previewDatabaseEnvironment.targets.length !== 1
    || previewDatabaseEnvironment.targets[0] !== "preview"
  ) {
    add(
      "STAGING_PREVIEW_DATABASE_ENV_UNCERTIFIED",
      previewDatabaseEnvironment?.id ?? "UNKNOWN",
      "Preview DATABASE_URL metadata does not match the certified environment record",
    );
  }
  for (const override of snapshot.branchScopedDatabaseOverrides) {
    add(
      "STAGING_BRANCH_DATABASE_OVERRIDE",
      `${override.key}:${override.id}`,
      "Branch-scoped database credentials are not permitted for Staging",
    );
  }

  const productionFingerprint = normalizedSha256(
    snapshot.databaseFingerprints.production,
  );
  const previewFingerprint = normalizedSha256(snapshot.databaseFingerprints.preview);
  if (
    previewFingerprint !== EXPECTED_PREVIEW_DATABASE_TARGET_FINGERPRINT
    || !productionFingerprint
  ) {
    add(
      "STAGING_DATABASE_ISOLATION_UNPROVEN",
      "Preview",
      "Staging database target fingerprints are not certified",
    );
  } else if (previewFingerprint === productionFingerprint) {
    add(
      "STAGING_DATABASE_REUSES_PRODUCTION",
      "Preview",
      "Staging and Production resolve to the same database target fingerprint",
    );
  }

  const actualMetadata = normalizedSha256(snapshot.databaseEnvironmentMetadata.actual);
  const expectedMetadata = normalizedSha256(snapshot.databaseEnvironmentMetadata.expected);
  if (!actualMetadata || !expectedMetadata) {
    add(
      "STAGING_DATABASE_METADATA_UNPROVEN",
      "Vercel",
      "Certified database environment metadata is unavailable",
    );
  } else if (actualMetadata !== expectedMetadata) {
    add(
      "STAGING_DATABASE_METADATA_CHANGED",
      "Vercel",
      "Database environment metadata changed after isolation certification",
    );
  }

  return Object.freeze({
    passed: findings.length === 0,
    findings: Object.freeze(findings),
  });
}

function isCriticalEnvironmentKey(key: string) {
  return isDatabaseCredentialKey(key)
    || key === "BETTER_AUTH_URL"
    || key === "PAYMENT_RETURN_BASE_URL"
    || key.endsWith("_SECRET")
    || key.endsWith("_TOKEN")
    || key.endsWith("_API_KEY")
    || key.startsWith("STRIPE_")
    || key.startsWith("NEXT_PUBLIC_STRIPE_")
    || key.startsWith("AFTERPAY_")
    || key.startsWith("RESEND_");
}

function isDatabaseCredentialKey(key: string) {
  return key === "DATABASE_URL"
    || key === "DATABASE_URL_UNPOOLED"
    || key === "PRODUCTION_DATABASE_URL"
    || key === "TEST_DATABASE_URL"
    || key === "POSTGRES_URL"
    || key === "POSTGRES_URL_NON_POOLING"
    || key === "POSTGRES_URL_NO_SSL"
    || key === "POSTGRES_PRISMA_URL"
    || key === "DIRECT_URL"
    || key === "PGHOST"
    || key === "PGHOST_UNPOOLED"
    || key === "PGPORT"
    || key === "PGDATABASE"
    || key === "PGUSER"
    || key === "PGPASSWORD"
    || key === "POSTGRES_HOST"
    || key === "POSTGRES_DATABASE"
    || key === "POSTGRES_USER"
    || key === "POSTGRES_PASSWORD";
}

export function databaseEnvironmentMetadataFingerprint(
  variables: readonly ProductionGuardEnvironmentVariable[],
) {
  const metadata = variables
    .filter(({ key }) => isDatabaseCredentialKey(key))
    .map((variable) => ({
      id: variable.id,
      key: variable.key,
      targets: [...variable.targets].sort(),
      gitBranch: variable.gitBranch ?? null,
      type: variable.type ?? null,
      updatedAt: variable.updatedAt ?? null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (metadata.length === 0) {
    throw new Error("Vercel database environment metadata is missing");
  }
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}

export function classifyMigrationLineage(
  local: readonly MigrationLineageEntry[],
  applied: readonly MigrationLineageEntry[],
): MigrationAudit {
  const summary = (status: MigrationAuditStatus): MigrationAudit => ({
    status,
    localCount: local.length,
    appliedCount: applied.length,
    lastLocalTimestamp: local.at(-1)?.createdAt,
    lastAppliedTimestamp: applied.at(-1)?.createdAt,
  });

  if (applied.length > local.length) return summary("UNKNOWN");
  for (const [position, entry] of applied.entries()) {
    const expected = local[position];
    if (!expected || entry.hash !== expected.hash || entry.createdAt !== expected.createdAt) {
      return summary("JOURNAL_HASH_MISMATCH");
    }
  }
  if (applied.length < local.length) return summary("NOT_APPLIED");
  return summary("MATCH");
}

export function evaluateProductionGuard(
  snapshot: ProductionGuardSnapshot,
): ProductionGuardResult {
  const findings: ProductionGuardFinding[] = [];
  const add = (code: string, subject: string, message: string) => {
    findings.push(finding(code, subject, message));
  };

  for (const item of evaluateStagingIsolation(snapshot.stagingIsolation).findings) {
    findings.push(item);
  }

  if (snapshot.github.repository !== EXPECTED_GITHUB_REPOSITORY) {
    add("GITHUB_REPOSITORY_MISMATCH", snapshot.github.repository, "Unexpected GitHub repository");
  }
  if (snapshot.github.forcePushAllowed) {
    add("MAIN_FORCE_PUSH_ALLOWED", "main", "GitHub main still permits force pushes");
  }
  if (snapshot.github.deletionAllowed) {
    add("MAIN_DELETION_ALLOWED", "main", "GitHub main still permits deletion");
  }
  if (!snapshot.github.linearHistoryRequired) {
    add("MAIN_LINEAR_HISTORY_NOT_REQUIRED", "main", "GitHub main does not require linear history");
  }
  if (snapshot.project.id !== EXPECTED_VERCEL_PROJECT_ID) {
    add("VERCEL_PROJECT_ID_MISMATCH", snapshot.project.id, "Unexpected Vercel project ID");
  }
  if (snapshot.project.name !== EXPECTED_VERCEL_PROJECT_NAME) {
    add("VERCEL_PROJECT_NAME_MISMATCH", snapshot.project.name, "Unexpected Vercel project name");
  }
  if (snapshot.project.productionBranch !== "main") {
    add(
      "VERCEL_PRODUCTION_BRANCH_NOT_MAIN",
      snapshot.project.productionBranch ?? "UNSET",
      "Vercel Production Branch must be main",
    );
  }
  if (snapshot.productionDeployment.branch !== "main") {
    add(
      "CURRENT_PRODUCTION_NOT_MAIN",
      snapshot.productionDeployment.id,
      "Current Production deployment did not originate from main",
    );
  }
  if (snapshot.productionDeployment.sha !== snapshot.originMainSha) {
    add(
      "PRODUCTION_SHA_MISMATCH",
      snapshot.productionDeployment.id,
      "Current Production SHA differs from origin/main",
    );
  }
  for (const domain of EXPECTED_PRODUCTION_DOMAINS) {
    if (!snapshot.productionDeployment.aliases.includes(domain)) {
      add("PRODUCTION_ALIAS_MISSING", domain, "Expected Production alias is missing");
    }
  }
  for (const deployment of snapshot.recentProductionDeployments) {
    if (deployment.branch !== "main") {
      add(
        "NON_MAIN_PRODUCTION_DEPLOYMENT",
        deployment.id,
        `NON-MAIN PRODUCTION DEPLOYMENT DETECTED (${deployment.branch ?? "UNKNOWN"}, ${deployment.sha ?? "UNKNOWN"}, ${deployment.createdAt})`,
      );
    }
  }

  for (const expectedDomain of EXPECTED_PRODUCTION_DOMAINS) {
    const domain = snapshot.domains.find(({ name }) => name === expectedDomain);
    if (!domain) {
      add("PROJECT_DOMAIN_MISSING", expectedDomain, "Expected domain is not assigned to the project");
      continue;
    }
    if (!domain.verified) {
      add("DOMAIN_NOT_VERIFIED", expectedDomain, "Domain is not verified");
    }
    if (domain.misconfigured) {
      add("DOMAIN_MISCONFIGURED", expectedDomain, "Domain is reported as misconfigured");
    }
    if (!domain.sslValid) {
      add("DOMAIN_SSL_INVALID", expectedDomain, "TLS validation failed");
    }
  }

  const envScopeCounts = new Map<string, number>();
  for (const variable of snapshot.environmentVariables) {
    if (!isCriticalEnvironmentKey(variable.key)) continue;
    for (const target of variable.targets) {
      const scope = `${variable.key}:${target}:${variable.gitBranch ?? "*"}`;
      envScopeCounts.set(scope, (envScopeCounts.get(scope) ?? 0) + 1);
    }
    if (
      isDatabaseCredentialKey(variable.key)
      && variable.targets.includes("production")
      && variable.targets.some((target) => target !== "production")
    ) {
      add(
        "PRODUCTION_DATABASE_SCOPE_SHARED",
        variable.key,
        "A Production database credential is shared with Preview or Development",
      );
    }
    if (variable.key === "PRODUCTION_DATABASE_URL"
      && variable.targets.some((target) => target !== "production")) {
      add(
        "PRODUCTION_DATABASE_SCOPE_SHARED",
        variable.key,
        "PRODUCTION_DATABASE_URL must be Production-only",
      );
    }
    if (variable.key === "TEST_DATABASE_URL" && variable.targets.includes("production")) {
      add(
        "TEST_DATABASE_EXPOSED_TO_PRODUCTION",
        variable.key,
        "TEST_DATABASE_URL must not be available to Production",
      );
    }
  }
  for (const [scope, count] of envScopeCounts) {
    if (count > 1) {
      const [key, target] = scope.split(":");
      add(
        "DUPLICATE_CRITICAL_ENV",
        `${key}:${target}`,
        "A critical environment key has multiple definitions in the same scope",
      );
    }
  }

  const databaseFingerprints = snapshot.databaseFingerprints;
  const isolationEntries = (Object.entries(databaseFingerprints) as Array<[
      keyof typeof databaseFingerprints,
      string | undefined,
    ]>)
    .map(([environment, fingerprint]) => [
      environment,
      normalizedSha256(fingerprint),
    ] as const);
  for (const [environment, fingerprint] of isolationEntries) {
    if (!fingerprint) {
      add(
        "DATABASE_ISOLATION_UNPROVEN",
        environment,
        "Database target fingerprint is not configured for the guard",
      );
    }
  }
  const presentFingerprints = isolationEntries.filter(
    (entry): entry is [keyof typeof databaseFingerprints, string] => Boolean(entry[1]),
  );
  for (const [index, [leftEnvironment, leftFingerprint]] of presentFingerprints.entries()) {
    for (const [rightEnvironment, rightFingerprint] of presentFingerprints.slice(index + 1)) {
      if (leftFingerprint === rightFingerprint) {
        add(
          "DATABASE_TARGET_REUSED",
          `${leftEnvironment}:${rightEnvironment}`,
          "Two environments resolve to the same database target fingerprint",
        );
      }
    }
  }
  const actualDatabaseEnvironmentMetadata = normalizedSha256(
    snapshot.databaseEnvironmentMetadata.actual,
  );
  const expectedDatabaseEnvironmentMetadata = normalizedSha256(
    snapshot.databaseEnvironmentMetadata.expected,
  );
  if (!actualDatabaseEnvironmentMetadata || !expectedDatabaseEnvironmentMetadata) {
    add(
      "DATABASE_ENV_METADATA_UNPROVEN",
      "Vercel",
      "Vercel database environment metadata baseline is not configured",
    );
  } else if (
    actualDatabaseEnvironmentMetadata !== expectedDatabaseEnvironmentMetadata
  ) {
    add(
      "DATABASE_ENV_METADATA_CHANGED",
      "Vercel",
      "Vercel database environment metadata changed after isolation certification",
    );
  }

  if (snapshot.migration.status !== "MATCH") {
    add(
      "MIGRATION_DRIFT",
      snapshot.migration.status,
      "Repository and Production migration lineage are not an exact match",
    );
  }

  return Object.freeze({
    passed: findings.length === 0,
    findings: Object.freeze(findings),
  });
}

type JsonRecord = Record<string, unknown>;

export function assertReadOnlyGuardRequest(
  url: string,
  init: Readonly<Pick<RequestInit, "method">> = {},
) {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("Production guard network requests must use GET or HEAD");
  }
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error("Production guard network requests must use HTTPS");
  }
  if (!READ_ONLY_GUARD_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error("Production guard request is outside the host allowlist");
  }
  if (target.username || target.password) {
    throw new Error("Production guard request URLs must not contain credentials");
  }
  return method;
}

function readOnlyGuardFetch(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
) {
  const method = assertReadOnlyGuardRequest(url, init);
  return fetcher(url, { ...init, method });
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} response is invalid`);
  }
  return value as JsonRecord;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function targetArray(value: unknown): EnvironmentTarget[] {
  const targets = typeof value === "string" ? [value] : stringArray(value);
  return targets.filter((target): target is EnvironmentTarget => (
    target === "production" || target === "preview" || target === "development"
  ));
}

function parseEnvironmentVariables(value: unknown): ProductionGuardEnvironmentVariable[] {
  const response = record(value, "Vercel environment metadata");
  return (Array.isArray(response.envs) ? response.envs : [])
    .map((item): ProductionGuardEnvironmentVariable => {
      const variable = record(item, "Vercel environment variable metadata");
      return {
        id: stringValue(variable.id) ?? "UNKNOWN",
        key: stringValue(variable.key) ?? "UNKNOWN",
        targets: targetArray(variable.target),
        gitBranch: stringValue(variable.gitBranch),
        type: stringValue(variable.type),
        updatedAt: typeof variable.updatedAt === "number"
          ? String(variable.updatedAt)
          : stringValue(variable.updatedAt),
      };
    });
}

async function jsonFetch(
  url: string,
  token: string,
  label: string,
  fetcher: typeof fetch,
): Promise<JsonRecord> {
  const response = await readOnlyGuardFetch(fetcher, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  return record(await response.json(), label);
}

async function readGitHubProtection(input: Readonly<{
  repository: string;
  token: string;
  fetcher: typeof fetch;
}>) {
  const response = await readOnlyGuardFetch(
    input.fetcher,
    `https://api.github.com/repos/${input.repository}/branches/main/protection`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) {
    return {
      repository: input.repository,
      forcePushAllowed: true,
      deletionAllowed: true,
      linearHistoryRequired: false,
    };
  }
  if (!response.ok) {
    throw new Error(`GitHub main protection request failed with HTTP ${response.status}`);
  }
  const protection = record(await response.json(), "GitHub main protection");
  const forcePushes = record(protection.allow_force_pushes ?? {}, "allow_force_pushes");
  const deletions = record(protection.allow_deletions ?? {}, "allow_deletions");
  const linearHistory = record(protection.required_linear_history ?? {}, "required_linear_history");
  return {
    repository: input.repository,
    forcePushAllowed: booleanValue(forcePushes.enabled),
    deletionAllowed: booleanValue(deletions.enabled),
    linearHistoryRequired: booleanValue(linearHistory.enabled),
  };
}

async function sslIsValid(domain: string, fetcher: typeof fetch) {
  try {
    await readOnlyGuardFetch(fetcher, `https://${domain}/`, {
      method: "HEAD",
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

export function parseDomainState(
  projectDomainValue: unknown,
  domainConfigValue: unknown,
  sslValid: boolean,
) {
  const projectDomain = record(projectDomainValue, "Vercel project domain");
  const domainConfig = record(domainConfigValue, "Vercel domain config");
  return {
    name: stringValue(projectDomain.name) ?? "UNKNOWN",
    verified: booleanValue(projectDomain.verified),
    misconfigured: domainConfig.misconfigured !== false,
    sslValid,
  };
}

function deploymentRecord(value: unknown) {
  const deployment = record(value, "Vercel deployment");
  const meta = record(deployment.meta ?? {}, "Vercel deployment metadata");
  const createdTimestamp = typeof deployment.created === "number"
    ? deployment.created
    : typeof deployment.createdAt === "number"
      ? deployment.createdAt
      : undefined;
  const created = createdTimestamp === undefined
    ? stringValue(deployment.createdAt) ?? "UNKNOWN"
    : new Date(createdTimestamp).toISOString();
  return {
    id: stringValue(deployment.uid) ?? stringValue(deployment.id) ?? "UNKNOWN",
    branch: stringValue(meta.githubCommitRef),
    sha: stringValue(meta.githubCommitSha),
    createdAt: created,
    aliases: stringArray(deployment.alias),
    ready: deployment.readyState === "READY" || deployment.state === "READY",
  };
}

export function parseCurrentProductionDeployment(value: unknown) {
  const project = record(value, "Vercel project");
  const targets = record(project.targets ?? {}, "Vercel project targets");
  return deploymentRecord(targets.production);
}

function parseStagingDeployment(value: unknown): StagingIsolationSnapshot["deployment"] {
  const deployment = record(value, "Vercel Staging deployment");
  const meta = record(deployment.meta ?? {}, "Vercel Staging deployment metadata");
  const gitSource = deployment.gitSource === undefined
    ? undefined
    : record(deployment.gitSource, "Vercel Staging Git source");
  const customEnvironment = deployment.customEnvironment === undefined
    ? undefined
    : record(deployment.customEnvironment, "Vercel custom environment");
  const target = deployment.target === null
    ? null
    : deployment.target === "production" || deployment.target === "staging"
      ? deployment.target
      : undefined;
  const customEnvironmentType = customEnvironment?.type === "production"
    || customEnvironment?.type === "preview"
    || customEnvironment?.type === "development"
    ? customEnvironment.type
    : undefined;

  return {
    id: stringValue(deployment.id) ?? stringValue(deployment.uid) ?? "UNKNOWN",
    projectId: stringValue(deployment.projectId),
    branch: stringValue(meta.githubCommitRef)
      ?? stringValue(meta.gitCommitRef)
      ?? stringValue(gitSource?.ref),
    ready: deployment.readyState === "READY" || deployment.state === "READY",
    target,
    customEnvironmentPresent: customEnvironment !== undefined,
    customEnvironmentType,
  };
}

export async function collectStagingIsolationSnapshot(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
}>): Promise<StagingIsolationSnapshot> {
  const fetcher = input.fetcher ?? fetch;
  const vercelToken = requiredEnvironment(input.env, "VERCEL_TOKEN");
  const vercelOrgId = requiredEnvironment(input.env, "VERCEL_ORG_ID");
  const vercelProjectId = requiredEnvironment(input.env, "VERCEL_PROJECT_ID");
  if (vercelProjectId !== EXPECTED_VERCEL_PROJECT_ID) {
    throw new Error("VERCEL_PROJECT_ID does not identify the governed project");
  }
  const teamQuery = `teamId=${encodeURIComponent(vercelOrgId)}`;
  const projectResponse = await jsonFetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}?${teamQuery}`,
    vercelToken,
    "Vercel project",
    fetcher,
  );
  const productionDeployment = parseCurrentProductionDeployment(projectResponse);
  const domainResponse = await jsonFetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(EXPECTED_STAGING_DOMAIN)}?${teamQuery}`,
    vercelToken,
    "Vercel Staging domain",
    fetcher,
  );
  const aliasResponse = await jsonFetch(
    `https://api.vercel.com/v4/aliases/${encodeURIComponent(EXPECTED_STAGING_DOMAIN)}?projectId=${encodeURIComponent(vercelProjectId)}&${teamQuery}`,
    vercelToken,
    "Vercel Staging alias",
    fetcher,
  );
  const aliasDeploymentId = stringValue(aliasResponse.deploymentId)
    ?? (aliasResponse.deployment === undefined
      ? undefined
      : stringValue(record(aliasResponse.deployment, "Vercel alias deployment").id));
  if (!aliasDeploymentId) {
    throw new Error("Vercel Staging alias deployment identity is missing");
  }
  const deploymentResponse = await jsonFetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(aliasDeploymentId)}?withGitRepoInfo=true&${teamQuery}`,
    vercelToken,
    "Vercel Staging deployment",
    fetcher,
  );
  const environmentVariables = parseEnvironmentVariables(await jsonFetch(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProjectId)}/env?limit=100&${teamQuery}`,
    vercelToken,
    "Vercel environment metadata",
    fetcher,
  ));

  return {
    domain: {
      name: stringValue(domainResponse.name) ?? "UNKNOWN",
      projectId: stringValue(domainResponse.projectId),
      gitBranch: stringValue(domainResponse.gitBranch),
      verified: booleanValue(domainResponse.verified),
    },
    alias: {
      name: stringValue(aliasResponse.alias) ?? "UNKNOWN",
      projectId: stringValue(aliasResponse.projectId),
      deploymentId: aliasDeploymentId,
    },
    deployment: parseStagingDeployment(deploymentResponse),
    productionDeploymentId: productionDeployment.id,
    previewDatabaseEnvironment: environmentVariables.find(
      ({ id }) => id === EXPECTED_PREVIEW_DATABASE_ENV_ID,
    ),
    branchScopedDatabaseOverrides: environmentVariables
      .filter(({ key, gitBranch }) => isDatabaseCredentialKey(key) && gitBranch !== undefined)
      .map(({ id, key }) => ({ id, key })),
    databaseFingerprints: {
      production: input.env.PRODUCTION_DATABASE_TARGET_FINGERPRINT?.trim(),
      preview: input.env.PREVIEW_DATABASE_TARGET_FINGERPRINT?.trim(),
    },
    databaseEnvironmentMetadata: {
      actual: databaseEnvironmentMetadataFingerprint(environmentVariables),
      expected: input.env.DATABASE_ENVIRONMENT_METADATA_FINGERPRINT?.trim(),
    },
  };
}

export async function auditProductionMigration(input: Readonly<{
  connectionString: string;
  expectedDatabase: string;
  expectedHostFingerprint: string;
  rootDir: string;
}>): Promise<MigrationAudit> {
  let hostname: string;
  try {
    hostname = new URL(input.connectionString).hostname;
  } catch {
    throw new Error("Production database audit URL is invalid");
  }
  const identity = await identifyDatabase(input.connectionString, hostname);
  verifyDatabaseIdentity({
    environment: "production",
    expectedDatabase: input.expectedDatabase,
    expectedHostFingerprint: input.expectedHostFingerprint,
  }, identity);
  const local = readLocalMigrationLineage(input.rootDir);
  const applied = await readAppliedMigrationLineage(input.connectionString);
  return classifyMigrationLineage(local, applied);
}

function requiredEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function collectProductionGuardSnapshot(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  rootDir: string;
  fetcher?: typeof fetch;
}>): Promise<ProductionGuardSnapshot> {
  const fetcher = input.fetcher ?? fetch;
  const vercelToken = requiredEnvironment(input.env, "VERCEL_TOKEN");
  const vercelOrgId = requiredEnvironment(input.env, "VERCEL_ORG_ID");
  const vercelProjectId = requiredEnvironment(input.env, "VERCEL_PROJECT_ID");
  const githubToken = requiredEnvironment(input.env, "GITHUB_TOKEN");
  if (vercelProjectId !== EXPECTED_VERCEL_PROJECT_ID) {
    throw new Error("VERCEL_PROJECT_ID does not identify the governed project");
  }

  const stagingIsolation = await collectStagingIsolationSnapshot({
    env: input.env,
    fetcher,
  });

  await execFile("git", ["fetch", "origin", "--prune"], { cwd: input.rootDir });
  const { stdout: originMainOutput } = await execFile(
    "git",
    ["rev-parse", "origin/main"],
    { cwd: input.rootDir },
  );
  const originMainSha = originMainOutput.trim();
  if (!/^[0-9a-f]{40}$/i.test(originMainSha)) {
    throw new Error("origin/main did not resolve to a full Git SHA");
  }

  const teamQuery = `teamId=${encodeURIComponent(vercelOrgId)}`;
  const projectResponse = await jsonFetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}?${teamQuery}`,
    vercelToken,
    "Vercel project",
    fetcher,
  );
  const projectLink = record(projectResponse.link ?? {}, "Vercel project link");
  const currentDeployment = parseCurrentProductionDeployment(projectResponse);
  if (!currentDeployment.ready) {
    throw new Error("Current Production deployment is not READY");
  }
  const deploymentsResponse = await jsonFetch(
    `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(vercelProjectId)}&target=production&limit=100&${teamQuery}`,
    vercelToken,
    "Vercel deployments",
    fetcher,
  );
  const deployments = Array.isArray(deploymentsResponse.deployments)
    ? deploymentsResponse.deployments.map(deploymentRecord)
    : [];

  const domainsResponse = await jsonFetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}/domains?limit=100&${teamQuery}`,
    vercelToken,
    "Vercel domains",
    fetcher,
  );
  const rawDomains = (Array.isArray(domainsResponse.domains) ? domainsResponse.domains : [])
    .filter((value) => {
      const domain = record(value, "Vercel domain");
      return EXPECTED_PRODUCTION_DOMAINS.includes(stringValue(domain.name) ?? "");
    });
  const domains = await Promise.all(rawDomains.map(async (value) => {
    const domain = record(value, "Vercel domain");
    const name = stringValue(domain.name) ?? "UNKNOWN";
    const config = await jsonFetch(
      `https://api.vercel.com/v6/domains/${encodeURIComponent(name)}/config?${teamQuery}`,
      vercelToken,
      `Vercel domain config (${name})`,
      fetcher,
    );
    return parseDomainState(domain, config, await sslIsValid(name, fetcher));
  }));

  const envResponse = await jsonFetch(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProjectId)}/env?limit=100&${teamQuery}`,
    vercelToken,
    "Vercel environment metadata",
    fetcher,
  );
  const environmentVariables = parseEnvironmentVariables(envResponse);

  const migration = await auditProductionMigration({
    connectionString: requiredEnvironment(input.env, "PRODUCTION_DATABASE_AUDIT_URL"),
    expectedDatabase: requiredEnvironment(input.env, "EXPECTED_PRODUCTION_DATABASE"),
    expectedHostFingerprint: requiredEnvironment(
      input.env,
      "EXPECTED_PRODUCTION_HOST_FINGERPRINT",
    ),
    rootDir: input.rootDir,
  });

  return {
    originMainSha,
    github: await readGitHubProtection({
      repository: EXPECTED_GITHUB_REPOSITORY,
      token: githubToken,
      fetcher,
    }),
    project: {
      id: stringValue(projectResponse.id) ?? "UNKNOWN",
      name: stringValue(projectResponse.name) ?? "UNKNOWN",
      productionBranch: stringValue(projectLink.productionBranch),
    },
    productionDeployment: currentDeployment,
    recentProductionDeployments: deployments.map(({ id, branch, sha, createdAt }) => ({
      id,
      branch,
      sha,
      createdAt,
    })),
    domains,
    environmentVariables,
    databaseFingerprints: {
      production: input.env.PRODUCTION_DATABASE_TARGET_FINGERPRINT?.trim(),
      preview: input.env.PREVIEW_DATABASE_TARGET_FINGERPRINT?.trim(),
      development: input.env.DEVELOPMENT_DATABASE_TARGET_FINGERPRINT?.trim(),
      test: input.env.TEST_DATABASE_TARGET_FINGERPRINT?.trim(),
    },
    databaseEnvironmentMetadata: {
      actual: databaseEnvironmentMetadataFingerprint(environmentVariables),
      expected: input.env.DATABASE_ENVIRONMENT_METADATA_FINGERPRINT?.trim(),
    },
    stagingIsolation,
    migration,
  };
}

async function main() {
  try {
    const snapshot = await collectProductionGuardSnapshot({
      env: process.env,
      rootDir: process.cwd(),
    });
    const result = evaluateProductionGuard(snapshot);
    if (result.passed) {
      process.stdout.write("PRODUCTION GUARD: PASS\n");
      process.stdout.write("PRODUCTION DRIFT AUDIT: PASS\n");
      return;
    }
    process.stderr.write("PRODUCTION GUARD: FAIL\n");
    for (const item of result.findings) {
      process.stderr.write(`${item.code}: ${item.subject} — ${item.message}\n`);
    }
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Production guard failed";
    process.stderr.write("PRODUCTION GUARD: FAIL\n");
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  void main();
}
