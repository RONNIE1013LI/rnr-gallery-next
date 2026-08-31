import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

const officialProductionHosts = new Set([
  "rnrgallery.com",
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);
const automationQueryParameter = "rnr_automation";
const maximumBrowserLifetimeMs = 120_000;
const closeTimeoutMs = 10_000;
const playwrightCliPackage = "@playwright/cli@0.1.18";

const customerChatAutomationProbe = `async () => {
  if (!document.body || !document.title) throw new Error("Production page did not render");
  const launcher = document.querySelector('button[aria-label="Chat with R&R Gallery"]');
  if (!(launcher instanceof HTMLButtonElement)) throw new Error("Customer Chat launcher was not found");
  launcher.click();
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const pollingRequests = performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/api/customer-chat/updates"));
  if (pollingRequests.length !== 0) {
    throw new Error("Automation mode started customer-chat polling");
  }
  return { title: document.title, customerChatPollingRequests: pollingRequests.length };
}`;

export type ProductionBrowserCheckDependencies = Readonly<{
  runCli: (session: string, args: string[], timeoutMs: number) => Promise<void>;
  processList: () => Promise<string>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
}>;

export type ProductionBrowserCheckOptions = Readonly<{
  url: string;
  session?: string;
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
  url.searchParams.set(automationQueryParameter, "1");
  return url;
}

export function productionBrowserSessionProcessIds(processList: string, session: string) {
  const rows = processRows(processList);
  const escapedSession = session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const daemonCommand = new RegExp(`cliDaemon\\.js\\s+${escapedSession}(?:\\s|$)`);
  const matched = new Set(rows
    .filter(({ command }) => daemonCommand.test(command))
    .map(({ pid }) => pid));
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

async function runCli(session: string, args: string[], timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["--yes", playwrightCliPackage, `-s=${session}`, ...args], {
      stdio: "inherit",
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
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
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

const defaultDependencies: ProductionBrowserCheckDependencies = {
  runCli,
  processList,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
};

async function stopLeakedSessionProcesses(
  session: string,
  trackedProcessIds: readonly number[],
  dependencies: ProductionBrowserCheckDependencies,
) {
  const current = await dependencies.processList();
  const currentIds = allProcessIds(current);
  const remaining = new Set([
    ...productionBrowserSessionProcessIds(current, session),
    ...trackedProcessIds.filter((pid) => currentIds.has(pid)),
  ]);
  if (remaining.size === 0) return;

  for (const pid of [...remaining].sort((left, right) => right - left)) {
    try {
      dependencies.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between inspection and termination.
    }
  }
  await dependencies.sleep(1_000);

  const afterTerm = await dependencies.processList();
  const afterTermIds = allProcessIds(afterTerm);
  const stubborn = [...remaining].filter((pid) => afterTermIds.has(pid));
  for (const pid of stubborn) {
    try {
      dependencies.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between inspection and termination.
    }
  }
  if (stubborn.length) await dependencies.sleep(250);

  const finalList = await dependencies.processList();
  const finalIds = allProcessIds(finalList);
  const leaked = stubborn.filter((pid) => finalIds.has(pid));
  if (leaked.length || productionBrowserSessionProcessIds(finalList, session).length) {
    throw new Error(`Production browser session ${session} did not close completely`);
  }
}

export async function runProductionBrowserCheck(
  options: ProductionBrowserCheckOptions,
  dependencies: ProductionBrowserCheckDependencies = defaultDependencies,
) {
  const url = buildProductionAutomationUrl(options.url);
  const session = options.session ?? `rnr-production-smoke-${process.pid}-${dependencies.now()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) {
    throw new Error("Production browser session name contains unsupported characters");
  }
  const deadline = dependencies.now() + maximumBrowserLifetimeMs;
  const remainingLifetime = () => {
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) throw new Error("Production browser maximum lifetime exceeded");
    return remaining;
  };
  let trackedProcessIds: number[] = [];

  try {
    await dependencies.runCli(session, ["open", url.toString(), "--browser", "chrome"], remainingLifetime());
    trackedProcessIds = productionBrowserSessionProcessIds(await dependencies.processList(), session);
    await dependencies.runCli(session, ["eval", customerChatAutomationProbe], remainingLifetime());
  } finally {
    try {
      await dependencies.runCli(session, ["close"], closeTimeoutMs);
    } finally {
      await stopLeakedSessionProcesses(session, trackedProcessIds, dependencies);
    }
  }

  return Object.freeze({
    session,
    url: url.toString(),
    maximumLifetimeMs: maximumBrowserLifetimeMs,
    customerChatPollingRequests: 0,
    browserProcessesAfterClose: 0,
  });
}

async function main() {
  const url = process.argv[2] ?? "https://rnrgallery.com/";
  const result = await runProductionBrowserCheck({ url });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
