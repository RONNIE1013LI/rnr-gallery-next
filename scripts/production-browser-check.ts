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
const productionSmokeRoutePaths = Object.freeze([
  "/",
  "/shop",
  "/canvas",
  "/banners",
  "/design-gallery",
  "/help",
  "/account",
  "/cart",
]);

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
  owner?: string;
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
  browserProcessesAfterClose: 0;
}>;

export type ProductionSmokeProgramConfig = Readonly<{
  url: string;
  capability: ProductionCapability;
  allowMedia: boolean;
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

export function buildProductionSmokeProgram(config: ProductionSmokeProgramConfig): string {
  const baseUrl = buildProductionAutomationUrl(config.url);
  baseUrl.searchParams.set(AUTOMATION_CAPABILITY_STORAGE_KEY, config.capability);
  const routeTargets = productionSmokeRoutePaths.map((path) => {
    const routeUrl = new URL(path, baseUrl);
    routeUrl.search = baseUrl.search;
    return { path, url: routeUrl.toString() };
  });
  const allowedNavigationBases = OFFICIAL_PRODUCTION_HOSTS.flatMap((hostname) =>
    productionSmokeRoutePaths.flatMap((path) => {
      const routeUrl = new URL(path, `https://${hostname}/`).toString();
      return path === "/" ? [routeUrl] : [routeUrl, `${routeUrl}/`];
    }));
  const blockedResourceTypes = ["image", "media", "font"].filter((resourceType) =>
    shouldBlockProductionResource(resourceType, config.capability, config.allowMedia));
  const programConfig = JSON.stringify({
    routeTargets,
    allowedNavigationBases,
    capability: config.capability,
    blockedResourceTypes,
    attributionParameterNames: ["gclid", "gbraid", "wbraid", "fbclid"],
    sessionStorageKey: AUTOMATION_SESSION_STORAGE_KEY,
    capabilityStorageKey: AUTOMATION_CAPABILITY_STORAGE_KEY,
  });

  return `async (page) => {
    const config = ${programConfig};
    const context = page.context();
    const blockedResourceCounts = {};
    const blockedResourceUrls = new Set();
    let unexpectedNavigationCount = 0;
    let consoleErrorCount = 0;
    let routeCount = 0;
    const attachConsoleListener = (candidate) => {
      candidate.on("console", (message) => {
        if (!message.type || message.type() !== "error") return;
        const text = message.text ? message.text() : "";
        const location = message.location ? message.location() : {};
        const expectedResourceBlock = blockedResourceUrls.has(location.url)
          && /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/.test(text);
        if (!expectedResourceBlock) consoleErrorCount += 1;
      });
    };
    for (const candidate of context.pages()) attachConsoleListener(candidate);
    context.on("page", attachConsoleListener);
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
          await route.abort();
          return;
        }
      }
      if (config.blockedResourceTypes.includes(resourceType)) {
        blockedResourceCounts[resourceType] = (blockedResourceCounts[resourceType] || 0) + 1;
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
    for (const routeTarget of config.routeTargets) {
      const response = await page.goto(routeTarget.url, { waitUntil: "networkidle" });
      if (unexpectedNavigationCount) throw new Error("Production smoke encountered an unexpected navigation");
      if (!response || response.status() >= 400) throw new Error("Production route returned an unsuccessful response");
      assertNoConsoleErrors();
      if (await page.locator("body").count() < 1) throw new Error("Production route did not render a body");
      assertNoConsoleErrors();
      routeCount += 1;
      if (routeTarget.path === "/") {
        await page.getByRole("button", { name: "Chat with R&R Gallery" }).click();
        assertNoConsoleErrors();
        await page.waitForTimeout(6_000);
        assertNoConsoleErrors();
        pollingCounts = await page.evaluate(() => {
          const entries = performance.getEntriesByType("resource");
          return {
            customerChat: entries.filter((entry) => entry.name.includes("/api/customer-chat/updates")).length,
            replyAssistant: entries.filter((entry) => entry.name.includes("/api/reply-assistant/updates")).length,
          };
        });
        assertNoConsoleErrors();
        if (pollingCounts.customerChat
          || (config.capability !== "REPLY_ASSISTANT_TEST" && pollingCounts.replyAssistant)) {
          throw new Error("Automation mode started customer-service polling");
        }
      }
    }
    assertNoConsoleErrors();
    if (unexpectedNavigationCount) throw new Error("Production smoke encountered an unexpected navigation");
    const result = { routeCount, blockedResourceCounts, pollingCounts, consoleErrorCount, unexpectedNavigationCount };
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

function parseOperationResult(value: unknown): ProductionSmokeOperationResult | undefined {
  if (typeof value === "string") {
    for (const line of value.trim().split("\n").reverse()) {
      try {
        const parsed = JSON.parse(line) as { rnrProductionBrowserCheck?: unknown };
        if (typeof parsed === "string") continue;
        const result = parseOperationResult(parsed.rnrProductionBrowserCheck ?? parsed);
        if (result) return result;
      } catch {
        // Playwright CLI may emit non-JSON progress lines before the result.
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.routeCount !== 8
    || !isNonNegativeInteger(candidate.consoleErrorCount)
    || !isNonNegativeInteger(candidate.unexpectedNavigationCount)
    || !isCounterRecord(candidate.blockedResourceCounts)
    || !candidate.pollingCounts
    || typeof candidate.pollingCounts !== "object"
    || Array.isArray(candidate.pollingCounts)) return undefined;
  const pollingCounts = candidate.pollingCounts as Record<string, unknown>;
  if (!isNonNegativeInteger(pollingCounts.customerChat)
    || !isNonNegativeInteger(pollingCounts.replyAssistant)) return undefined;
  return {
    routeCount: 8,
    blockedResourceCounts: candidate.blockedResourceCounts,
    pollingCounts: {
      customerChat: pollingCounts.customerChat,
      replyAssistant: pollingCounts.replyAssistant,
    },
    consoleErrorCount: candidate.consoleErrorCount,
    unexpectedNavigationCount: candidate.unexpectedNavigationCount,
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
    const output = await dependencies.runCli(session, ["run-code", buildProductionSmokeProgram({ url: url.toString(), capability, allowMedia: options.allowMedia === true })], remainingLifetime());
    operationResult = parseOperationResult(output);
    if (!operationResult) {
      throw new Error("Playwright CLI did not return a valid Production browser result");
    }
    if (operationResult.consoleErrorCount !== 0) {
      throw new Error("Production browser operation reported a console error");
    }
    if (operationResult.unexpectedNavigationCount !== 0) {
      throw new Error("Production browser operation reported an unexpected navigation");
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
  for (const arg of args) {
    if (arg === "--media") {
      allowMedia = true;
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
  return { url, capability, ttlSeconds, allowMedia };
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
    browserProcessesAfterClose: result.browserProcessesAfterClose,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
