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

type ProcessRow = Readonly<{ pid: number; ppid: number; command: string }>;

function processRows(processList: string): ProcessRow[] {
  return processList.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }];
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

export function productionBrowserSessionProcessIds(processList: string, session: string) {
  const rows = processRows(processList);
  const escapedSession = session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const daemonCommand = new RegExp(`cliDaemon\\.js\\s+${escapedSession}(?:\\s|$)`);
  const matched = new Set(rows.filter(({ command }) => daemonCommand.test(command)).map(({ pid }) => pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!matched.has(row.pid) && matched.has(row.ppid)) {
        matched.add(row.pid);
        changed = true;
      }
    }
  }
  return [...matched].sort((left, right) => left - right);
}

function allProcessIds(processList: string) {
  return new Set(processRows(processList).map(({ pid }) => pid));
}

async function runCli(session: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("npx", ["--yes", playwrightCliPackage, `-s=${session}`, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
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
      finish(new Error(`Playwright CLI command exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`Playwright CLI exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function processList() {
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 10 * 1024 * 1024 });
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

async function stopLeakedSessionProcesses(session: string, trackedProcessIds: readonly number[], dependencies: ProductionBrowserCheckDependencies) {
  const current = await dependencies.processList();
  const currentIds = allProcessIds(current);
  const remaining = new Set([
    ...productionBrowserSessionProcessIds(current, session),
    ...trackedProcessIds.filter((pid) => currentIds.has(pid)),
  ]);
  if (remaining.size === 0) return;

  for (const pid of [...remaining].sort((left, right) => right - left)) {
    try { dependencies.kill(pid, "SIGTERM"); } catch { /* process exited */ }
  }
  await dependencies.sleep(1_000);
  const afterTerm = await dependencies.processList();
  const afterTermIds = allProcessIds(afterTerm);
  const stubborn = [...remaining].filter((pid) => afterTermIds.has(pid));
  for (const pid of stubborn) {
    try { dependencies.kill(pid, "SIGKILL"); } catch { /* process exited */ }
  }
  if (stubborn.length) await dependencies.sleep(250);
  const finalList = await dependencies.processList();
  const finalIds = allProcessIds(finalList);
  const leaked = stubborn.filter((pid) => finalIds.has(pid));
  if (leaked.length || productionBrowserSessionProcessIds(finalList, session).length) {
    throw new Error(`Production browser session ${session} did not close completely`);
  }
}

export function buildProductionSmokeProgram(config: ProductionSmokeProgramConfig): string {
  const blockedResourceTypes = ["image", "media", "font"].filter((resourceType) =>
    shouldBlockProductionResource(resourceType, config.capability, config.allowMedia));
  const programConfig = JSON.stringify({
    url: config.url,
    capability: config.capability,
    blockedResourceTypes,
    officialHosts: OFFICIAL_PRODUCTION_HOSTS,
    sessionStorageKey: AUTOMATION_SESSION_STORAGE_KEY,
    capabilityStorageKey: AUTOMATION_CAPABILITY_STORAGE_KEY,
  });

  return `async (page) => {
    const config = ${programConfig};
    const context = page.context();
    const blockedResourceCounts = {};
    let unexpectedNavigationCount = 0;
    let consoleErrorCount = 0;
    let routeCount = 0;
    const attachConsoleListener = (candidate) => {
      candidate.on("console", (message) => {
        if (message.type && message.type() === "error") consoleErrorCount += 1;
      });
    };
    for (const candidate of context.pages()) attachConsoleListener(candidate);
    context.on("page", attachConsoleListener);
    await context.addInitScript(({ sessionStorageKey, capabilityStorageKey, capability }) => {
      sessionStorage.setItem(sessionStorageKey, "1");
      sessionStorage.setItem(capabilityStorageKey, capability);
    }, config);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const frame = request.frame();
      const isTopLevelDocument = request.isNavigationRequest()
        && resourceType === "document"
        && frame === frame.page().mainFrame();
      if (isTopLevelDocument && !config.officialHosts.includes(new URL(request.url()).hostname)) {
        unexpectedNavigationCount += 1;
        await route.abort();
        return;
      }
      if (config.blockedResourceTypes.includes(resourceType)) {
        blockedResourceCounts[resourceType] = (blockedResourceCounts[resourceType] || 0) + 1;
        await route.abort();
        return;
      }
      await route.continue();
    });
    let pollingCounts = { customerChat: 0, replyAssistant: 0 };
    for (const path of ["/", "/shop", "/canvas", "/banners", "/design-gallery", "/help", "/account", "/cart"]) {
      const consoleErrorsBeforeRoute = consoleErrorCount;
      const routeUrl = new URL(path, config.url);
      if (path === "/") routeUrl.search = new URL(config.url).search;
      const response = await page.goto(routeUrl.toString(), { waitUntil: "networkidle" });
      if (unexpectedNavigationCount) throw new Error("Production smoke encountered an unexpected navigation");
      if (!response || response.status() >= 400) throw new Error("Production route returned an unsuccessful response");
      if (await page.locator("body").count() < 1) throw new Error("Production route did not render a body");
      if (consoleErrorCount !== consoleErrorsBeforeRoute) throw new Error("Production route emitted a console error");
      routeCount += 1;
      if (path === "/") {
        await page.getByRole("button", { name: "Chat with R&R Gallery" }).click();
        await page.waitForTimeout(6_000);
        pollingCounts = await page.evaluate(() => {
          const entries = performance.getEntriesByType("resource");
          return {
            customerChat: entries.filter((entry) => entry.name.includes("/api/customer-chat/updates")).length,
            replyAssistant: entries.filter((entry) => entry.name.includes("/api/reply-assistant/updates")).length,
          };
        });
        if (config.capability !== "REPLY_ASSISTANT_TEST" && (pollingCounts.customerChat || pollingCounts.replyAssistant)) {
          throw new Error("Automation mode started customer-service polling");
        }
      }
    }
    const result = { routeCount, blockedResourceCounts, pollingCounts, consoleErrorCount, unexpectedNavigationCount };
    return result;
  }`;
}

function parseOperationResult(value: unknown): Omit<ProductionBrowserCheckResult, "session" | "capability" | "ttlSeconds" | "browserProcessesAfterClose"> | undefined {
  if (typeof value === "string") {
    for (const line of value.trim().split("\n").reverse()) {
      try {
        const parsed = JSON.parse(line) as { rnrProductionBrowserCheck?: unknown };
        return parseOperationResult(parsed.rnrProductionBrowserCheck ?? parsed);
      } catch {
        // Playwright CLI may emit non-JSON progress lines before the result.
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.routeCount === "number"
    && typeof candidate.consoleErrorCount === "number"
    && typeof candidate.unexpectedNavigationCount === "number"
    && !!candidate.blockedResourceCounts
    && typeof candidate.blockedResourceCounts === "object"
    && !!candidate.pollingCounts
    && typeof candidate.pollingCounts === "object") {
    return value as Omit<ProductionBrowserCheckResult, "session" | "capability" | "ttlSeconds" | "browserProcessesAfterClose">;
  }
  return undefined;
}

export async function runProductionBrowserCheck(
  options: ProductionBrowserCheckOptions,
  dependencies: ProductionBrowserCheckDependencies = defaultDependencies,
): Promise<ProductionBrowserCheckResult> {
  if (dependencies.env.RNR_PRODUCTION_SMOKE !== "1") {
    throw new Error("Production browser checks require RNR_PRODUCTION_SMOKE=1");
  }
  const capability = options.capability ?? "DEFAULT";
  const ttlSeconds = resolveProductionTtlSeconds(capability, options.ttlSeconds);
  const startedAt = dependencies.now();
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
  let trackedProcessIds: number[] = [];
  let operationResult: Omit<ProductionBrowserCheckResult, "session" | "capability" | "ttlSeconds" | "browserProcessesAfterClose"> = {
    routeCount: 0,
    blockedResourceCounts: {},
    pollingCounts: { customerChat: 0, replyAssistant: 0 },
    consoleErrorCount: 0,
    unexpectedNavigationCount: 0,
  };

  try {
    await dependencies.runCli(session, ["open", "about:blank", "--browser", "chrome"], remainingLifetime());
    trackedProcessIds = productionBrowserSessionProcessIds(await dependencies.processList(), session);
    const output = await dependencies.runCli(session, ["run-code", buildProductionSmokeProgram({ url: url.toString(), capability, allowMedia: options.allowMedia === true })], remainingLifetime());
    operationResult = parseOperationResult(output) ?? operationResult;
  } finally {
    try {
      await dependencies.runCli(session, ["close"], closeTimeoutMs);
    } finally {
      await stopLeakedSessionProcesses(session, trackedProcessIds, dependencies);
    }
  }

  return Object.freeze({ ...operationResult, session, capability, ttlSeconds, browserProcessesAfterClose: 0 });
}

function parseCliArguments(args: readonly string[]): ProductionBrowserCheckOptions {
  let url = "https://rnrgallery.com/";
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
    } else if (url === "https://rnrgallery.com/") {
      url = arg;
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
