import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  AUTOMATION_CAPABILITY_STORAGE_KEY,
  AUTOMATION_SESSION_STORAGE_KEY,
  OFFICIAL_PRODUCTION_HOSTS,
  buildProductionSmokeUrl,
  resolveGuardStatus,
  resolveProductionTtlSeconds,
  shouldBlockProductionResource,
  type ProductionCapability,
} from "./automation/production-access-guard";

const execFile = promisify(execFileCallback);
const officialProductionHosts = new Set(OFFICIAL_PRODUCTION_HOSTS);
const closeTimeoutMs = 10_000;
const playwrightCliPackage = "@playwright/cli@0.1.18";
const maxCliDiagnosticLength = 2_000;
const maxCapturedCliOutputLength = 10_000;
const baselineProductionSmokeRoutePaths = Object.freeze([
  "/",
  "/shop",
  "/canvas",
  "/banners",
  "/design-gallery",
  "/help",
  "/account",
  "/cart",
]);
const productionCoverageRouteTargets = Object.freeze([
  { path: "/au/shop", kind: "pricing" },
  { path: "/sitemap.xml", kind: "sitemap" },
  { path: "/media/home/homepage-hero-showcase-16x9.webp", kind: "public-media" },
  { path: "/reply-assistant", kind: "reply-assistant" },
  { path: "/order-system", kind: "forms-orders" },
] as const);
const productionCoverageRedirectPaths = Object.freeze([
  "/account/sign-in",
  "/order-system/sign-in",
]);
const productionAuthRouteTargets = Object.freeze([
  { path: "/reply-assistant", kind: "reply-assistant" },
  { path: "/order-system", kind: "forms-orders" },
] as const);

export type ProductionBrowserCheckDependencies = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  runCli: (session: string, args: string[], timeoutMs: number) => Promise<unknown>;
  processList: () => Promise<string>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  randomHex: () => string;
}>;

export type ProductionBrowserCheckOptions = Readonly<{
  url: string;
  capability?: ProductionCapability;
  ttlSeconds?: number;
  allowMedia?: boolean;
  coverageOnly?: boolean;
  authOnly?: boolean;
  owner?: string;
}>;

export type ProductionCoverageEvidence = Readonly<{
  sitemap: boolean;
  publicMedia: boolean;
  pricing: boolean;
  replyAssistantInitialLoad: "authenticated" | "auth-gated";
  formsOrdersInitialLoad: "authenticated" | "auth-gated";
  websiteChatInitialLoad: boolean;
}>;

export type ProductionAuthCoverageEvidence = Readonly<{
  replyAssistantAuthBoundary: "auth-gated";
  replyAssistantCanonicalNext: "/reply-assistant";
  replyAssistantPolling: Readonly<{ customerChat: number; replyAssistant: number }>;
  formsOrdersAuthBoundary: "authenticated" | "auth-gated";
  formsOrdersCanonicalNext: "/order-system" | null;
  formsOrdersPolling: Readonly<{ customerChat: number; replyAssistant: number }>;
  expectedAuthRedirectCount: number;
}>;

export type ProductionBrowserCheckResult = Readonly<{
  session: string;
  owner: string;
  startedAt: string;
  capability: ProductionCapability;
  ttlSeconds: number;
  routeCount: number;
  blockedResourceCounts: Readonly<Record<string, number>>;
  pollingCounts: Readonly<{ customerChat: number; replyAssistant: number }>;
  consoleErrorCount: number;
  unexpectedNavigationCount: number;
  requestFailedCount: number;
  ignoredRequestFailedCounts: Readonly<{
    guardBlocked: number;
    navigationAborted: number;
  }>;
  blockedMutationRequestCount: number;
  consentLocallyFulfilledCount: number;
  coverage?: ProductionCoverageEvidence;
  authCoverage?: ProductionAuthCoverageEvidence;
  browserProcessesAfterClose: 0;
}>;

export type ProductionSmokeProgramConfig = Readonly<{
  url: string;
  capability: ProductionCapability;
  allowMedia: boolean;
  coverageOnly?: boolean;
  authOnly?: boolean;
}>;

export type PlaywrightCliFailure = Readonly<{
  stage: string;
  exitCode: number | string;
  stdout?: string;
  stderr?: string;
}>;

type ProcessRow = Readonly<{
  pid: number;
  ppid: number;
  startedAt: string;
  command: string;
}>;

type OwnedProcessIdentity = Readonly<{
  process: ProcessRow;
  ancestry: readonly ProcessRow[];
}>;

type ProductionSmokeOperationResult = Pick<
  ProductionBrowserCheckResult,
  | "routeCount"
  | "blockedResourceCounts"
  | "pollingCounts"
  | "consoleErrorCount"
  | "unexpectedNavigationCount"
  | "requestFailedCount"
  | "ignoredRequestFailedCounts"
  | "blockedMutationRequestCount"
  | "consentLocallyFulfilledCount"
  | "coverage"
  | "authCoverage"
>;

function processRows(processList: string): ProcessRow[] {
  return processList.split("\n").flatMap((line) => {
    const match = line.trim().match(
      /^(\d+)\s+(\d+)\s+(\S{3}\s+\S{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
    );
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAt: match[3],
      command: match[4],
    }];
  });
}

export function buildProductionAutomationUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !officialProductionHosts.has(url.hostname)) {
    throw new Error("Production browser checks require an official Production host over HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Production browser check URLs must not include credentials");
  }
  url.searchParams.set(AUTOMATION_SESSION_STORAGE_KEY, "1");
  return url;
}

function sanitizePlaywrightCliOutput(value: string | undefined) {
  const sanitized = (value ?? "")
    .replace(/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]*/gi, "$1: [REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|DATABASE_URL|COOKIE|API_KEY)[A-Z0-9_]*)\s*=\s*[^\s\r\n]*/gi, "$1=[REDACTED]")
    .replace(/(["'](?:access[_-]?token|authorization|cookie|credential|database_url|password|secret|session|token)["']\s*:\s*)(["'])[^"']*\2/gi, "$1$2[REDACTED]$2")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(/([?&](?:access_token|auth|code|cookie|credential|key|password|secret|session|token)=)[^&#\s]*/gi, "$1[REDACTED]")
    .trim();
  if (!sanitized) return "(empty)";
  if (sanitized.length <= maxCliDiagnosticLength) return sanitized;
  return `${sanitized.slice(0, maxCliDiagnosticLength)}\n...[truncated]`;
}

export function formatPlaywrightCliFailure(input: PlaywrightCliFailure) {
  const stage = /^[a-z0-9-]{1,32}$/i.test(input.stage) ? input.stage : "unknown";
  const exitCode = typeof input.exitCode === "number" && Number.isInteger(input.exitCode)
    ? String(input.exitCode)
    : /^[a-z0-9-]{1,32}$/i.test(String(input.exitCode)) ? String(input.exitCode) : "unknown";
  return [
    "Playwright CLI failure",
    `stage: ${stage}`,
    `exit code: ${exitCode}`,
    `stdout:\n${sanitizePlaywrightCliOutput(input.stdout)}`,
    `stderr:\n${sanitizePlaywrightCliOutput(input.stderr)}`,
  ].join("\n");
}

function productionBrowserSessionProcessIdentities(
  processList: string,
  session: string,
): OwnedProcessIdentity[] {
  const rows = processRows(processList);
  const escapedSession = session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const daemonCommand = new RegExp(`cliDaemon\\.js\\s+${escapedSession}(?:\\s|$)`);
  const matched = new Map<number, OwnedProcessIdentity>();
  for (const row of rows) {
    if (daemonCommand.test(row.command)) {
      matched.set(row.pid, { process: row, ancestry: [row] });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const parent = matched.get(row.ppid);
      if (!matched.has(row.pid) && parent) {
        matched.set(row.pid, {
          process: row,
          ancestry: [...parent.ancestry, row],
        });
        changed = true;
      }
    }
  }
  return [...matched.values()].sort((left, right) =>
    right.ancestry.length - left.ancestry.length || right.process.pid - left.process.pid);
}

export function productionBrowserSessionProcessIds(processList: string, session: string) {
  return productionBrowserSessionProcessIdentities(processList, session)
    .map(({ process }) => process.pid)
    .sort((left, right) => left - right);
}

async function runCli(session: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("npx", ["--yes", playwrightCliPackage, `-s=${session}`, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const stage = args[0] ?? "unknown";
    let stdout = "";
    let stderr = "";
    const appendOutput = (current: string, chunk: unknown) =>
      `${current}${String(chunk)}`.slice(0, maxCapturedCliOutputLength);
    child.stdout?.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = appendOutput(stderr, chunk); });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(formatPlaywrightCliFailure({
        stage,
        exitCode: "timeout",
        stdout,
        stderr: `${stderr}\nCommand exceeded ${timeoutMs}ms`,
      })));
    }, timeoutMs);
    child.once("error", (error) => finish(new Error(formatPlaywrightCliFailure({
      stage,
      exitCode: "spawn-error",
      stdout,
      stderr: `${stderr}\n${error.message}`,
    }))));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(formatPlaywrightCliFailure({
        stage,
        exitCode: code ?? signal ?? "unknown",
        stdout,
        stderr,
      })));
    });
  });
}

async function processList() {
  const { stdout } = await execFile(
    "ps",
    ["-axo", "pid=,ppid=,lstart=,command="],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

const defaultDependencies: ProductionBrowserCheckDependencies = {
  env: process.env,
  runCli,
  processList,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
  randomHex: () => randomBytes(4).toString("hex"),
};

function sameProcessRow(left: ProcessRow, right: ProcessRow) {
  return left.pid === right.pid
    && left.ppid === right.ppid
    && left.startedAt === right.startedAt
    && left.command === right.command;
}

function sameOwnedProcessIdentity(left: OwnedProcessIdentity, right: OwnedProcessIdentity) {
  return left.ancestry.length === right.ancestry.length
    && left.ancestry.every((row, index) => sameProcessRow(row, right.ancestry[index]));
}

async function signalIfStillOwned(
  session: string,
  identity: OwnedProcessIdentity,
  signal: NodeJS.Signals,
  dependencies: ProductionBrowserCheckDependencies,
) {
  const current = productionBrowserSessionProcessIdentities(
    await dependencies.processList(),
    session,
  );
  const matched = current.find(({ process }) => process.pid === identity.process.pid);
  if (!matched || !sameOwnedProcessIdentity(identity, matched)) return false;
  try {
    dependencies.kill(identity.process.pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function stopLeakedSessionProcesses(
  session: string,
  trackedProcesses: readonly OwnedProcessIdentity[],
  dependencies: ProductionBrowserCheckDependencies,
) {
  const discovered = productionBrowserSessionProcessIdentities(
    await dependencies.processList(),
    session,
  );
  const candidates = new Map<number, OwnedProcessIdentity>();
  for (const identity of trackedProcesses) {
    candidates.set(identity.process.pid, identity);
  }
  for (const identity of discovered) {
    if (!candidates.has(identity.process.pid)) {
      candidates.set(identity.process.pid, identity);
    }
  }
  const ordered = [...candidates.values()].sort((left, right) =>
    right.ancestry.length - left.ancestry.length || right.process.pid - left.process.pid);
  if (ordered.length === 0) return;

  let termSignals = 0;
  for (const identity of ordered) {
    if (await signalIfStillOwned(session, identity, "SIGTERM", dependencies)) termSignals += 1;
  }
  if (termSignals) await dependencies.sleep(1_000);

  let killSignals = 0;
  for (const identity of ordered) {
    if (await signalIfStillOwned(session, identity, "SIGKILL", dependencies)) killSignals += 1;
  }
  if (killSignals) await dependencies.sleep(250);

  const finalList = await dependencies.processList();
  const finalRows = processRows(finalList);
  const knownProcessStillRunning = ordered.some(({ process }) =>
    finalRows.some((row) => row.pid === process.pid
      && row.startedAt === process.startedAt
      && row.command === process.command));
  if (knownProcessStillRunning || productionBrowserSessionProcessIds(finalList, session).length) {
    throw new Error(`Production browser session ${session} did not close completely`);
  }
}

type ProductionAuthBoundaryContract = Readonly<{
  kind: "reply-assistant" | "forms-orders";
  protectedPath: "/reply-assistant" | "/order-system";
  protectedBase: string;
  signInPath: "/account/sign-in" | "/order-system/sign-in";
  signInBase: string;
  canonicalNext: "/reply-assistant" | "/order-system";
}>;

export function buildProductionAuthBoundaryContracts(rawUrl: string): readonly ProductionAuthBoundaryContract[] {
  const baseUrl = buildProductionAutomationUrl(rawUrl);
  const definitions = [
    {
      kind: "reply-assistant",
      protectedPath: "/reply-assistant",
      signInPath: "/account/sign-in",
      canonicalNext: "/reply-assistant",
    },
    {
      kind: "forms-orders",
      protectedPath: "/order-system",
      signInPath: "/order-system/sign-in",
      canonicalNext: "/order-system",
    },
  ] as const;
  return definitions.map((definition) => ({
    ...definition,
    protectedBase: new URL(definition.protectedPath, baseUrl).toString().split("?", 1)[0],
    signInBase: new URL(definition.signInPath, baseUrl).toString().split("?", 1)[0],
  }));
}

export function normalizeProductionAuthReturnTarget(
  target: unknown,
  ignoredQueryParameterNames: readonly string[],
): string | null {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return null;
  }
  const hashIndex = target.indexOf("#");
  const withoutHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const rawHash = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1);
  if (!/^\/[a-zA-Z0-9/_-]{0,127}$/.test(pathname) || pathname.includes("//")) return null;
  const pathSegments = pathname.endsWith("/")
    ? pathname.split("/").slice(1, -1)
    : pathname.split("/").slice(1);
  if (pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  const queryEntries: string[][] = [];
  for (const entry of rawQuery.split("&").filter(Boolean)) {
    const parts = entry.split("=");
    try {
      const key = decodeURIComponent((parts.shift() ?? "").split("+").join(" "));
      const value = decodeURIComponent(parts.join("=").split("+").join(" "));
      if (!ignoredQueryParameterNames.includes(key)) queryEntries.push([key, value]);
    } catch {
      return null;
    }
  }
  queryEntries.sort((left, right) =>
    left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  let hash: string;
  try {
    hash = decodeURIComponent(rawHash.split("+").join(" "));
  } catch {
    return null;
  }
  return JSON.stringify([pathname, queryEntries, hash]);
}

export function buildProductionSmokeProgram(config: ProductionSmokeProgramConfig): string {
  const baseUrl = buildProductionAutomationUrl(config.url);
  baseUrl.searchParams.set(AUTOMATION_CAPABILITY_STORAGE_KEY, config.capability);
  if (config.coverageOnly && config.authOnly) {
    throw new Error("Production browser check modes are mutually exclusive");
  }
  const routeDefinitions = config.authOnly
    ? productionAuthRouteTargets
    : config.coverageOnly
      ? productionCoverageRouteTargets
      : baselineProductionSmokeRoutePaths.map((path) => ({ path, kind: "baseline" as const }));
  const routeTargets = routeDefinitions.map(({ path, kind }) => {
    const routeUrl = new URL(path, baseUrl);
    routeUrl.search = baseUrl.search;
    return { path, kind, url: routeUrl.toString() };
  });
  const allowedRoutePaths = [
    ...routeDefinitions.map(({ path }) => path),
    ...((config.coverageOnly || config.authOnly) ? productionCoverageRedirectPaths : []),
  ];
  const allowedNavigationBases = OFFICIAL_PRODUCTION_HOSTS.flatMap((hostname) =>
    allowedRoutePaths.flatMap((path) => {
      const routeUrl = new URL(path, `https://${hostname}/`).toString();
      return path === "/" ? [routeUrl] : [routeUrl, `${routeUrl}/`];
    }));
  const blockedResourceTypes = ["image", "media", "font"].filter((resourceType) =>
    shouldBlockProductionResource(resourceType, config.capability, config.allowMedia));
  const localConsentPostUrls = (config.coverageOnly || config.authOnly)
    ? OFFICIAL_PRODUCTION_HOSTS.map((hostname) => `https://${hostname}/api/consent`)
    : [];
  const localConsentResponseBody = JSON.stringify({
    consent: {
      version: 1,
      analytics: true,
      advertising: true,
      decidedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  const programConfig = JSON.stringify({
    routeTargets,
    allowedNavigationBases,
    capability: config.capability,
    coverageOnly: config.coverageOnly === true,
    authOnly: config.authOnly === true,
    authBoundaryContracts: buildProductionAuthBoundaryContracts(config.url),
    blockedResourceTypes,
    localConsentPostUrls,
    localConsentResponseBody,
    attributionParameterNames: ["gclid", "gbraid", "wbraid", "fbclid"],
    harnessAuthQueryParameterNames: [
      AUTOMATION_SESSION_STORAGE_KEY,
      AUTOMATION_CAPABILITY_STORAGE_KEY,
    ],
    sessionStorageKey: AUTOMATION_SESSION_STORAGE_KEY,
    capabilityStorageKey: AUTOMATION_CAPABILITY_STORAGE_KEY,
  });

  return `async (page) => {
    const config = ${programConfig};
    const context = page.context();
    if (config.coverageOnly || config.authOnly) await context.clearCookies();
    const blockedResourceCounts = {};
    const blockedResourceUrls = new Set();
    const guardBlockedRequests = new WeakSet();
    let unexpectedNavigationCount = 0;
    let consoleErrorCount = 0;
    let requestFailedCount = 0;
    const ignoredRequestFailedCounts = { guardBlocked: 0, navigationAborted: 0 };
    let blockedMutationRequestCount = 0;
    let consentLocallyFulfilledCount = 0;
    let controlledNavigationInProgress = false;
    let routeCount = 0;
    let activeNavigationResponses = [];
    const attachPageListeners = (candidate) => {
      candidate.on("console", (message) => {
        if (!message.type || message.type() !== "error") return;
        const text = message.text ? message.text() : "";
        const location = message.location ? message.location() : {};
        const expectedResourceBlock = blockedResourceUrls.has(location.url)
          && /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/.test(text);
        if (!expectedResourceBlock) consoleErrorCount += 1;
      });
      candidate.on("requestfailed", (request) => {
        if (guardBlockedRequests.has(request)) {
          ignoredRequestFailedCounts.guardBlocked += 1;
          return;
        }
        const errorText = request.failure && request.failure()?.errorText;
        if (controlledNavigationInProgress && errorText === "net::ERR_ABORTED") {
          ignoredRequestFailedCounts.navigationAborted += 1;
          return;
        }
        requestFailedCount += 1;
      });
      candidate.on("response", (response) => {
        if (candidate !== page || (!config.coverageOnly && !config.authOnly)) return;
        const responseUrl = response.url ? response.url() : "";
        const hashIndex = responseUrl.indexOf("#");
        const withoutHash = hashIndex === -1 ? responseUrl : responseUrl.slice(0, hashIndex);
        const queryIndex = withoutHash.indexOf("?");
        const responseBase = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
        if (config.authBoundaryContracts.some((contract) =>
          contract.protectedBase === responseBase || contract.signInBase === responseBase)) {
          activeNavigationResponses.push({ base: responseBase, status: response.status() });
        }
      });
    };
    for (const candidate of context.pages()) attachPageListeners(candidate);
    context.on("page", attachPageListeners);
    await context.addInitScript(({ sessionStorageKey, capabilityStorageKey, capability }) => {
      try {
        sessionStorage.setItem(sessionStorageKey, "1");
        sessionStorage.setItem(capabilityStorageKey, capability);
      } catch {
        // Query markers remain authoritative when browser storage is unavailable.
      }
    }, config);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const method = request.method().toUpperCase();
      if (method === "POST" && config.localConsentPostUrls.includes(request.url())) {
        consentLocallyFulfilledCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: config.localConsentResponseBody,
        });
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        blockedMutationRequestCount += 1;
        guardBlockedRequests.add(request);
        blockedResourceUrls.add(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      const frame = request.frame();
      const isTopLevelDocument = request.isNavigationRequest()
        && resourceType === "document"
        && frame === frame.page().mainFrame();
      if (isTopLevelDocument) {
        let allowedNavigation = false;
        try {
          const requestUrl = request.url();
          const hashIndex = requestUrl.indexOf("#");
          const withoutHash = hashIndex === -1 ? requestUrl : requestUrl.slice(0, hashIndex);
          const queryIndex = withoutHash.indexOf("?");
          const navigationBase = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
          const rawQuery = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1);
          const hasAttribution = rawQuery.split("&").filter(Boolean).some((entry) => {
            const rawKey = entry.split("=", 1)[0].split("+").join(" ");
            const normalized = decodeURIComponent(rawKey).toLowerCase();
            return config.attributionParameterNames.includes(normalized) || normalized.startsWith("utm_");
          });
          allowedNavigation = config.allowedNavigationBases.includes(navigationBase)
            && (!hasAttribution || config.capability === "ATTRIBUTION");
        } catch {
          allowedNavigation = false;
        }
        if (!allowedNavigation) {
          unexpectedNavigationCount += 1;
          guardBlockedRequests.add(request);
          blockedResourceUrls.add(request.url());
          await route.abort();
          return;
        }
      }
      if (config.blockedResourceTypes.includes(resourceType)) {
        blockedResourceCounts[resourceType] = (blockedResourceCounts[resourceType] || 0) + 1;
        guardBlockedRequests.add(request);
        blockedResourceUrls.add(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    let pollingCounts = { customerChat: 0, replyAssistant: 0 };
    const assertNoConsoleErrors = () => {
      if (consoleErrorCount) throw new Error("Production browser operation emitted a console error");
    };
    const assertNoNetworkFailures = () => {
      if (requestFailedCount) throw new Error("Production browser operation emitted a failed network request");
    };
    const normalizeAuthReturnTarget = ${normalizeProductionAuthReturnTarget.toString()};
    const authReturnTargetMatches = (actual, expected) => {
      const normalizedExpected = normalizeAuthReturnTarget(
        expected,
        config.harnessAuthQueryParameterNames,
      );
      return normalizedExpected !== null
        && normalizeAuthReturnTarget(actual, config.harnessAuthQueryParameterNames) === normalizedExpected;
    };
    const authBoundaryDiagnostic = (contract, currentUrl, canonicalNext) => {
      const hashIndex = currentUrl.indexOf("#");
      const withoutHash = hashIndex === -1 ? currentUrl : currentUrl.slice(0, hashIndex);
      const queryIndex = withoutHash.indexOf("?");
      const currentBase = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
      const rawQuery = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1);
      const originEnd = currentBase.indexOf("/", "https://".length);
      const rawPathname = originEnd === -1 ? "/" : currentBase.slice(originEnd);
      const pathname = /^\\/[a-zA-Z0-9/_-]{0,127}$/.test(rawPathname) ? rawPathname : "(invalid)";
      const sensitiveKey = /^(?:access_token|auth|authorization|code|cookie|credential|key|password|secret|session|token)$/i;
      const queryKeys = rawQuery.split("&").filter(Boolean).map((entry) => {
        try {
          const key = decodeURIComponent(entry.split("=", 1)[0].split("+").join(" "));
          if (sensitiveKey.test(key)) return "[redacted]";
          return /^[a-zA-Z0-9_.-]{1,64}$/.test(key) ? key : "[invalid]";
        } catch {
          return "[invalid]";
        }
      }).sort((left, right) => left === "next" ? -1 : right === "next" ? 1 : left.localeCompare(right));
      const redirectStatus = activeNavigationResponses.map((entry) => entry.status).join("->") || "(none)";
      const safeNext = authReturnTargetMatches(canonicalNext, contract.canonicalNext)
        ? contract.canonicalNext
        : canonicalNext === null ? "(missing)" : "(mismatch)";
      return "pathname=" + pathname
        + "; query_keys=" + (queryKeys.join(",") || "(none)")
        + "; canonical_next=" + safeNext
        + "; redirect_status=" + redirectStatus;
    };
    const inspectAuthBoundary = (contract, currentUrl, requireRedirect) => {
      const hashIndex = currentUrl.indexOf("#");
      const withoutHash = hashIndex === -1 ? currentUrl : currentUrl.slice(0, hashIndex);
      const queryIndex = withoutHash.indexOf("?");
      const currentBase = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
      const rawQuery = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1);
      let canonicalNext = null;
      let nextCount = 0;
      for (const entry of rawQuery.split("&").filter(Boolean)) {
        try {
          const parts = entry.split("=");
          const key = decodeURIComponent(parts.shift().split("+").join(" "));
          if (key !== "next") continue;
          nextCount += 1;
          let decoded = parts.join("=").split("+").join(" ");
          for (let iteration = 0; iteration < 3; iteration += 1) {
            const nextDecoded = decodeURIComponent(decoded);
            const unchanged = nextDecoded === decoded;
            decoded = nextDecoded;
            if (decoded.startsWith("/") || unchanged) break;
          }
          canonicalNext = decoded;
        } catch {
          canonicalNext = "(invalid)";
        }
      }
      const responseBases = activeNavigationResponses.map((entry) => entry.base);
      const hasRedirectLoop = new Set(responseBases).size !== responseBases.length;
      if (hasRedirectLoop) {
        throw new Error(contract.kind + " auth redirect loop: "
          + authBoundaryDiagnostic(contract, currentUrl, canonicalNext));
      }
      const authenticated = currentBase === contract.protectedBase
        && activeNavigationResponses.length === 1
        && activeNavigationResponses[0].base === contract.protectedBase
        && activeNavigationResponses[0].status === 200;
      const authGated = currentBase === contract.signInBase
        && nextCount === 1
        && authReturnTargetMatches(canonicalNext, contract.canonicalNext)
        && activeNavigationResponses.length === 2
        && activeNavigationResponses[0].base === contract.protectedBase
        && activeNavigationResponses[0].status === 307
        && activeNavigationResponses[1].base === contract.signInBase
        && activeNavigationResponses[1].status === 200;
      if ((!authGated && !authenticated) || (requireRedirect && !authGated)) {
        throw new Error(contract.kind + " auth boundary failed: "
          + authBoundaryDiagnostic(contract, currentUrl, canonicalNext));
      }
      return {
        state: authGated ? "auth-gated" : "authenticated",
        canonicalNext: authGated ? contract.canonicalNext : null,
      };
    };
    const coverage = config.coverageOnly ? {
      sitemap: false,
      publicMedia: false,
      pricing: false,
      replyAssistantInitialLoad: null,
      formsOrdersInitialLoad: null,
      websiteChatInitialLoad: false,
    } : undefined;
    const authCoverage = config.authOnly ? {
      replyAssistantAuthBoundary: null,
      replyAssistantCanonicalNext: null,
      replyAssistantPolling: null,
      formsOrdersAuthBoundary: null,
      formsOrdersCanonicalNext: null,
      formsOrdersPolling: null,
      expectedAuthRedirectCount: 0,
    } : undefined;
    for (const routeTarget of config.routeTargets) {
      activeNavigationResponses = [];
      controlledNavigationInProgress = true;
      let response;
      try {
        response = await page.goto(routeTarget.url, { waitUntil: "networkidle" });
      } finally {
        controlledNavigationInProgress = false;
      }
      if (unexpectedNavigationCount) throw new Error("Production smoke encountered an unexpected navigation");
      if (!response || response.status() >= 400) throw new Error("Production route returned an unsuccessful response");
      assertNoConsoleErrors();
      assertNoNetworkFailures();
      if (!["sitemap", "public-media"].includes(routeTarget.kind)
        && await page.locator("body").count() < 1) {
        throw new Error("Production route did not render a body");
      }
      assertNoConsoleErrors();
      routeCount += 1;

      if (routeTarget.kind === "pricing") {
        const priceTexts = (await page.locator("strong").allTextContents())
          .map((value) => value.trim())
          .filter((value) => value.startsWith("From A$") && value.endsWith(" AUD"));
        const validPrices = priceTexts.every((value) => {
          const amount = value.slice("From A$".length, -" AUD".length).split(",").join("");
          const parts = amount.split(".");
          return parts.length === 2
            && parts[0].length > 0
            && parts[1].length === 2
            && [...parts[0], ...parts[1]].every((character) => character >= "0" && character <= "9");
        });
        if (!priceTexts.length || !validPrices) {
          throw new Error("Australia pricing did not render current fixed AUD values");
        }
        coverage.pricing = true;
        await page.getByRole("button", { name: "Chat with R&R Gallery" }).click();
        assertNoConsoleErrors();
        await page.waitForTimeout(1_000);
        assertNoConsoleErrors();
        if (await page.locator('[role="dialog"][aria-label="Chat with R&R Gallery"]').count() !== 1) {
          throw new Error("Website Chat did not complete its read-only initial load");
        }
        coverage.websiteChatInitialLoad = true;
      }

      if (routeTarget.kind === "sitemap") {
        const sitemap = await response.text();
        if (!sitemap.includes("<urlset") || !sitemap.includes("https://rnrgallery.com/au")) {
          throw new Error("Production sitemap did not include the Australia route");
        }
        coverage.sitemap = true;
      }

      if (routeTarget.kind === "public-media") {
        const contentType = (await response.headerValue("content-type")) || "";
        const body = await response.body();
        if (!contentType.toLowerCase().startsWith("image/webp") || body.length < 1) {
          throw new Error("Approved public media did not return a non-empty WebP response");
        }
        coverage.publicMedia = true;
      }

      if (routeTarget.kind === "reply-assistant") {
        const contract = config.authBoundaryContracts.find((candidate) => candidate.kind === "reply-assistant");
        const boundary = inspectAuthBoundary(contract, page.url(), config.authOnly);
        if (boundary.state === "authenticated") {
          if (await page.getByRole("heading", { name: "Reply Assistant" }).count() !== 1) {
            throw new Error("Reply Assistant did not render its initial view");
          }
        } else {
          if (await page.getByRole("heading", { name: "Welcome back." }).count() !== 1) {
            throw new Error("Reply Assistant auth gate did not render");
          }
        }
        if (coverage) coverage.replyAssistantInitialLoad = boundary.state;
        if (authCoverage) {
          authCoverage.replyAssistantAuthBoundary = boundary.state;
          authCoverage.replyAssistantCanonicalNext = boundary.canonicalNext;
          authCoverage.expectedAuthRedirectCount += boundary.state === "auth-gated" ? 1 : 0;
        }
      }

      if (routeTarget.kind === "forms-orders") {
        const contract = config.authBoundaryContracts.find((candidate) => candidate.kind === "forms-orders");
        const boundary = inspectAuthBoundary(contract, page.url(), false);
        if (boundary.state === "authenticated") {
          if (await page.getByRole("heading", { name: "Order system data list" }).count() !== 1) {
            throw new Error("Forms/Orders did not render its initial view");
          }
        } else {
          if (await page.getByRole("heading", { name: "Studio workbench." }).count() !== 1) {
            throw new Error("Forms/Orders auth gate did not render");
          }
        }
        if (coverage) coverage.formsOrdersInitialLoad = boundary.state;
        if (authCoverage) {
          authCoverage.formsOrdersAuthBoundary = boundary.state;
          authCoverage.formsOrdersCanonicalNext = boundary.canonicalNext;
          authCoverage.expectedAuthRedirectCount += boundary.state === "auth-gated" ? 1 : 0;
        }
      }

      if (routeTarget.path === "/") {
        await page.getByRole("button", { name: "Chat with R&R Gallery" }).click();
        assertNoConsoleErrors();
        await page.waitForTimeout(6_000);
        assertNoConsoleErrors();
      }

      if (routeTarget.path === "/" || routeTarget.kind === "pricing" || config.authOnly) {
        pollingCounts = await page.evaluate(() => {
          const entries = performance.getEntriesByType("resource");
          return {
            customerChat: entries.filter((entry) => entry.name.includes("/api/customer-chat/updates")).length,
            replyAssistant: entries.filter((entry) => entry.name.includes("/api/reply-assistant/updates")).length,
          };
        });
        assertNoConsoleErrors();
        if ((config.authOnly && (pollingCounts.customerChat || pollingCounts.replyAssistant))
          || pollingCounts.customerChat
          || (config.capability !== "REPLY_ASSISTANT_TEST" && pollingCounts.replyAssistant)) {
          throw new Error("Automation mode started customer-service polling");
        }
        if (authCoverage && routeTarget.kind === "reply-assistant") {
          authCoverage.replyAssistantPolling = pollingCounts;
        }
        if (authCoverage && routeTarget.kind === "forms-orders") {
          authCoverage.formsOrdersPolling = pollingCounts;
        }
      }
      assertNoNetworkFailures();
    }
    assertNoConsoleErrors();
    assertNoNetworkFailures();
    if (unexpectedNavigationCount) throw new Error("Production smoke encountered an unexpected navigation");
    if (coverage && (!coverage.sitemap
      || !coverage.publicMedia
      || !coverage.pricing
      || !coverage.replyAssistantInitialLoad
      || !coverage.formsOrdersInitialLoad
      || !coverage.websiteChatInitialLoad)) {
      throw new Error("Production coverage smoke did not prove every approved surface");
    }
    if (authCoverage && (authCoverage.replyAssistantAuthBoundary !== "auth-gated"
      || authCoverage.replyAssistantCanonicalNext !== "/reply-assistant"
      || !authCoverage.replyAssistantPolling
      || !authCoverage.formsOrdersAuthBoundary
      || !authCoverage.formsOrdersPolling
      || (authCoverage.formsOrdersAuthBoundary === "auth-gated"
        && authCoverage.formsOrdersCanonicalNext !== "/order-system"))) {
      throw new Error("Production auth smoke did not prove every approved auth boundary");
    }
    const result = {
      routeCount,
      blockedResourceCounts,
      pollingCounts,
      consoleErrorCount,
      unexpectedNavigationCount,
      requestFailedCount,
      ignoredRequestFailedCounts,
      blockedMutationRequestCount,
      consentLocallyFulfilledCount,
      ...(coverage ? { coverage } : {}),
      ...(authCoverage ? { authCoverage } : {}),
    };
    return result;
  }`;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCounterRecord(value: unknown): value is Readonly<Record<string, number>> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.entries(value).every(([key, count]) =>
      ["image", "media", "font"].includes(key) && isNonNegativeInteger(count));
}

function parseOperationResult(
  value: unknown,
  expectedRouteCount: number,
  coverageOnly: boolean,
  authOnly: boolean,
): ProductionSmokeOperationResult | undefined {
  if (typeof value === "string") {
    for (const line of value.trim().split("\n").reverse()) {
      try {
        const parsed = JSON.parse(line) as { rnrProductionBrowserCheck?: unknown };
        if (typeof parsed === "string") continue;
        const result = parseOperationResult(
          parsed.rnrProductionBrowserCheck ?? parsed,
          expectedRouteCount,
          coverageOnly,
          authOnly,
        );
        if (result) return result;
      } catch {
        // Playwright CLI may emit non-JSON progress lines before the result.
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.routeCount !== expectedRouteCount
    || !isNonNegativeInteger(candidate.consoleErrorCount)
    || !isNonNegativeInteger(candidate.unexpectedNavigationCount)
    || !isNonNegativeInteger(candidate.requestFailedCount)
    || !isNonNegativeInteger(candidate.blockedMutationRequestCount)
    || !isNonNegativeInteger(candidate.consentLocallyFulfilledCount)
    || !isCounterRecord(candidate.blockedResourceCounts)
    || !candidate.pollingCounts
    || typeof candidate.pollingCounts !== "object"
    || Array.isArray(candidate.pollingCounts)) return undefined;
  const pollingCounts = candidate.pollingCounts as Record<string, unknown>;
  if (!isNonNegativeInteger(pollingCounts.customerChat)
    || !isNonNegativeInteger(pollingCounts.replyAssistant)) return undefined;
  if (!candidate.ignoredRequestFailedCounts
    || typeof candidate.ignoredRequestFailedCounts !== "object"
    || Array.isArray(candidate.ignoredRequestFailedCounts)) return undefined;
  const ignoredRequestFailedCounts = candidate.ignoredRequestFailedCounts as Record<string, unknown>;
  if (!isNonNegativeInteger(ignoredRequestFailedCounts.guardBlocked)
    || !isNonNegativeInteger(ignoredRequestFailedCounts.navigationAborted)) return undefined;
  let coverage: ProductionCoverageEvidence | undefined;
  if (coverageOnly) {
    if (!candidate.coverage || typeof candidate.coverage !== "object" || Array.isArray(candidate.coverage)) {
      return undefined;
    }
    const coverageCandidate = candidate.coverage as Record<string, unknown>;
    if (coverageCandidate.sitemap !== true
      || coverageCandidate.publicMedia !== true
      || coverageCandidate.pricing !== true
      || !["authenticated", "auth-gated"].includes(String(coverageCandidate.replyAssistantInitialLoad))
      || !["authenticated", "auth-gated"].includes(String(coverageCandidate.formsOrdersInitialLoad))
      || coverageCandidate.websiteChatInitialLoad !== true) return undefined;
    coverage = coverageCandidate as ProductionCoverageEvidence;
  }
  let authCoverage: ProductionAuthCoverageEvidence | undefined;
  if (authOnly) {
    if (!candidate.authCoverage
      || typeof candidate.authCoverage !== "object"
      || Array.isArray(candidate.authCoverage)) return undefined;
    const authCandidate = candidate.authCoverage as Record<string, unknown>;
    const validPolling = (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const counts = value as Record<string, unknown>;
      return counts.customerChat === 0 && counts.replyAssistant === 0;
    };
    if (authCandidate.replyAssistantAuthBoundary !== "auth-gated"
      || authCandidate.replyAssistantCanonicalNext !== "/reply-assistant"
      || !validPolling(authCandidate.replyAssistantPolling)
      || !["authenticated", "auth-gated"].includes(String(authCandidate.formsOrdersAuthBoundary))
      || (authCandidate.formsOrdersAuthBoundary === "auth-gated"
        && authCandidate.formsOrdersCanonicalNext !== "/order-system")
      || (authCandidate.formsOrdersAuthBoundary === "authenticated"
        && authCandidate.formsOrdersCanonicalNext !== null)
      || !validPolling(authCandidate.formsOrdersPolling)
      || ![1, 2].includes(Number(authCandidate.expectedAuthRedirectCount))) return undefined;
    authCoverage = authCandidate as ProductionAuthCoverageEvidence;
  }
  return {
    routeCount: expectedRouteCount,
    blockedResourceCounts: candidate.blockedResourceCounts,
    pollingCounts: {
      customerChat: pollingCounts.customerChat,
      replyAssistant: pollingCounts.replyAssistant,
    },
    consoleErrorCount: candidate.consoleErrorCount,
    unexpectedNavigationCount: candidate.unexpectedNavigationCount,
    requestFailedCount: candidate.requestFailedCount,
    ignoredRequestFailedCounts: {
      guardBlocked: ignoredRequestFailedCounts.guardBlocked,
      navigationAborted: ignoredRequestFailedCounts.navigationAborted,
    },
    blockedMutationRequestCount: candidate.blockedMutationRequestCount,
    consentLocallyFulfilledCount: candidate.consentLocallyFulfilledCount,
    ...(coverage ? { coverage } : {}),
    ...(authCoverage ? { authCoverage } : {}),
  };
}

function resolvePrivacySafeOwner(value: string | undefined) {
  const owner = value?.trim() || "local-runner";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(owner)) {
    throw new Error("Production browser checks require a privacy-safe owner label");
  }
  return owner;
}

export async function runProductionBrowserCheck(
  options: ProductionBrowserCheckOptions,
  dependencies: ProductionBrowserCheckDependencies = defaultDependencies,
): Promise<ProductionBrowserCheckResult> {
  if (dependencies.env.RNR_PRODUCTION_SMOKE !== "1") {
    throw new Error("Production browser checks require RNR_PRODUCTION_SMOKE=1");
  }
  const owner = resolvePrivacySafeOwner(options.owner);
  const capability = options.capability ?? "DEFAULT";
  const ttlSeconds = resolveProductionTtlSeconds(capability, options.ttlSeconds);
  const startedAt = dependencies.now();
  if (!Number.isFinite(startedAt)) throw new Error("Production browser start time is invalid");
  const startedAtIso = new Date(startedAt).toISOString();
  const url = buildProductionSmokeUrl({
    rawUrl: buildProductionAutomationUrl(options.url).toString(),
    capability,
    guardStatus: resolveGuardStatus(dependencies.env, new Date(startedAt)),
    productionSmokeAuthorized: true,
    now: new Date(startedAt),
  });
  const suffix = dependencies.randomHex();
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error("Production browser session suffix must be 8 lowercase hex characters");
  const session = `rnr-production-smoke-${process.pid}-${startedAt}-${suffix}`;
  const deadline = startedAt + ttlSeconds * 1_000;
  const remainingLifetime = () => {
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) throw new Error("Production browser maximum lifetime exceeded");
    return remaining;
  };
  let trackedProcesses: OwnedProcessIdentity[] = [];
  let operationResult: ProductionSmokeOperationResult | undefined;

  try {
    await dependencies.runCli(session, ["open", "about:blank", "--browser", "chrome"], remainingLifetime());
    trackedProcesses = productionBrowserSessionProcessIdentities(
      await dependencies.processList(),
      session,
    );
    const output = await dependencies.runCli(session, ["run-code", buildProductionSmokeProgram({
      url: url.toString(),
      capability,
      allowMedia: options.allowMedia === true,
      coverageOnly: options.coverageOnly === true,
      authOnly: options.authOnly === true,
    })], remainingLifetime());
    operationResult = parseOperationResult(
      output,
      options.authOnly
        ? productionAuthRouteTargets.length
        : options.coverageOnly
          ? productionCoverageRouteTargets.length
          : baselineProductionSmokeRoutePaths.length,
      options.coverageOnly === true,
      options.authOnly === true,
    );
    if (!operationResult) {
      throw new Error("Playwright CLI did not return a valid Production browser result");
    }
    if (operationResult.consoleErrorCount !== 0) {
      throw new Error("Production browser operation reported a console error");
    }
    if (operationResult.unexpectedNavigationCount !== 0) {
      throw new Error("Production browser operation reported an unexpected navigation");
    }
    if (operationResult.requestFailedCount !== 0) {
      throw new Error("Production browser operation reported a failed network request");
    }
    if (options.coverageOnly && operationResult.consentLocallyFulfilledCount < 1) {
      throw new Error("Production coverage smoke did not locally fulfill consent");
    }
    if (operationResult.pollingCounts.customerChat !== 0
      || (capability !== "REPLY_ASSISTANT_TEST" && operationResult.pollingCounts.replyAssistant !== 0)) {
      throw new Error("Production browser operation reported customer-service polling");
    }
  } finally {
    try {
      await dependencies.runCli(session, ["close"], closeTimeoutMs);
    } finally {
      await stopLeakedSessionProcesses(session, trackedProcesses, dependencies);
    }
  }

  if (!operationResult) {
    throw new Error("Playwright CLI did not return a valid Production browser result");
  }
  return Object.freeze({
    ...operationResult,
    session,
    owner,
    startedAt: startedAtIso,
    capability,
    ttlSeconds,
    browserProcessesAfterClose: 0,
  });
}

function parseCliArguments(args: readonly string[]): ProductionBrowserCheckOptions {
  let url = "https://rnrgallery.com/";
  let positionalUrlSeen = false;
  let capability: ProductionCapability | undefined;
  let ttlSeconds: number | undefined;
  let allowMedia = false;
  let coverageOnly = false;
  let authOnly = false;
  for (const arg of args) {
    if (arg === "--media") {
      allowMedia = true;
    } else if (arg === "--coverage-only") {
      coverageOnly = true;
    } else if (arg === "--auth-only") {
      authOnly = true;
    } else if (arg.startsWith("--capability=")) {
      const value = arg.slice("--capability=".length) as ProductionCapability;
      if (!["DEFAULT", "VISUAL", "ATTRIBUTION", "REPLY_ASSISTANT_TEST", "EXTENDED"].includes(value)) throw new Error("Invalid --capability");
      capability = value;
    } else if (arg.startsWith("--ttl=")) {
      const value = arg.slice("--ttl=".length);
      if (!/^\d+$/.test(value)) throw new Error("Invalid --ttl");
      ttlSeconds = Number(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (!positionalUrlSeen) {
      url = arg;
      positionalUrlSeen = true;
    } else {
      throw new Error("Only one Production URL may be provided");
    }
  }
  if (coverageOnly && authOnly) throw new Error("--coverage-only and --auth-only are mutually exclusive");
  return { url, capability, ttlSeconds, allowMedia, coverageOnly, authOnly };
}

async function main() {
  const result = await runProductionBrowserCheck(parseCliArguments(process.argv.slice(2)));
  console.log(JSON.stringify({
    session: result.session,
    owner: result.owner,
    startedAt: result.startedAt,
    capability: result.capability,
    ttlSeconds: result.ttlSeconds,
    routeCount: result.routeCount,
    blockedResourceCounts: result.blockedResourceCounts,
    pollingCounts: result.pollingCounts,
    consoleErrorCount: result.consoleErrorCount,
    unexpectedNavigationCount: result.unexpectedNavigationCount,
    requestFailedCount: result.requestFailedCount,
    ignoredRequestFailedCounts: result.ignoredRequestFailedCounts,
    blockedMutationRequestCount: result.blockedMutationRequestCount,
    consentLocallyFulfilledCount: result.consentLocallyFulfilledCount,
    ...(result.coverage ? { coverage: result.coverage } : {}),
    ...(result.authCoverage ? { authCoverage: result.authCoverage } : {}),
    browserProcessesAfterClose: result.browserProcessesAfterClose,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
