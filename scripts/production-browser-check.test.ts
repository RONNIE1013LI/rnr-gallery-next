import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildProductionAutomationUrl,
  buildProductionSmokeProgram,
  formatPlaywrightCliFailure,
  productionBrowserSessionProcessIds,
  runProductionBrowserCheck,
  type ProductionBrowserCheckDependencies,
} from "./production-browser-check";

type OperationResult = Readonly<{
  routeCount: number;
  blockedResourceCounts: Readonly<Record<string, number>>;
  pollingCounts: Readonly<{ customerChat: number; replyAssistant: number }>;
  consoleErrorCount: number;
  unexpectedNavigationCount: number;
}>;

function validOperationResult(overrides: Partial<OperationResult> = {}): OperationResult {
  return {
    routeCount: 8,
    blockedResourceCounts: {},
    pollingCounts: { customerChat: 0, replyAssistant: 0 },
    consoleErrorCount: 0,
    unexpectedNavigationCount: 0,
    ...overrides,
  };
}

function dependencies(overrides: Partial<ProductionBrowserCheckDependencies> = {}) {
  return {
    env: { RNR_PRODUCTION_SMOKE: "1" },
    runCli: vi.fn(async (_session: string, args: string[]) =>
      args[0] === "run-code" ? JSON.stringify(validOperationResult()) : undefined),
    processList: vi.fn().mockResolvedValue(""),
    kill: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(1_000),
    randomHex: vi.fn().mockReturnValue("deadbeef"),
    ...overrides,
  } satisfies ProductionBrowserCheckDependencies;
}

type FakeConsoleMessage = Readonly<{
  type: () => string;
  text: () => string;
  location: () => Readonly<{ url: string }>;
}>;
type FakeFrame = Readonly<{ page: () => FakePage }>;
type FakeRequest = Readonly<{
  url: () => string;
  resourceType: () => string;
  isNavigationRequest: () => boolean;
  frame: () => FakeFrame;
}>;
type FakeRoute = Readonly<{
  request: () => FakeRequest;
  continue: () => Promise<void>;
  abort: (errorCode?: string) => Promise<void>;
}>;
type FakeInitScriptInput = Readonly<{
  sessionStorageKey: string;
  capabilityStorageKey: string;
  capability: string;
}>;
type FakeContext = Readonly<{
  addInitScript: (
    script: (input: FakeInitScriptInput) => void,
    input: FakeInitScriptInput,
  ) => Promise<void>;
  route: (pattern: string, handler: (route: FakeRoute) => Promise<void>) => Promise<void>;
  on: (event: "page", handler: (page: FakePage) => void) => void;
  pages: () => FakePage[];
}>;
type FakePage = Readonly<{
  context: () => FakeContext;
  mainFrame: () => FakeFrame;
  on: (event: "console", handler: (message: FakeConsoleMessage) => void) => void;
  goto: (url: string, options?: Readonly<{ waitUntil: string }>) => Promise<Readonly<{ status: () => number }>>;
  locator: (selector: string) => Readonly<{ count: () => Promise<number> }>;
  getByRole: (
    role: string,
    options: Readonly<{ name: string }>,
  ) => Readonly<{ click: () => Promise<void> }>;
  waitForTimeout: (milliseconds: number) => Promise<void>;
  evaluate: (callback: () => unknown) => Promise<Readonly<{ customerChat: number; replyAssistant: number }>>;
}>;

type Fixture = Readonly<{
  url: string;
  resourceType: string;
  navigation?: boolean;
  page?: FakePage;
}>;

function createFakePage(options: Readonly<{
  bodyCount?: number;
  pollingCounts?: Readonly<{ customerChat?: number; replyAssistant?: number }>;
  externalPopupOnFirstGoto?: boolean;
  popupNavigationOnFirstGoto?: string;
  topLevelNavigationOnFirstGoto?: string;
  consoleErrorDuringChat?: "click" | "wait" | "evaluate";
  blockedImageOnFirstGoto?: boolean;
  storageBlocked?: boolean;
}> = {}) {
  const events: string[] = [];
  const continued: string[] = [];
  const aborted: string[] = [];
  const visited: string[] = [];
  let routeHandler: ((route: FakeRoute) => Promise<void>) | undefined;
  const pageListeners: Array<(page: FakePage) => void> = [];
  const consoleListeners = new Map<FakePage, Array<(message: FakeConsoleMessage) => void>>();
  const pages: FakePage[] = [];

  const context: FakeContext = {
    addInitScript: vi.fn(async (script: (input: FakeInitScriptInput) => void, input: FakeInitScriptInput) => {
      events.push("init");
      const original = (globalThis as { sessionStorage?: unknown }).sessionStorage;
      const storage = new Map<string, string>();
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: {
          setItem: (key: string, value: string) => {
            if (options.storageBlocked) throw new Error("sessionStorage blocked");
            storage.set(key, value);
          },
        },
      });
      try {
        script(input);
      } finally {
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: original });
      }
      events.push(`storage:${storage.get("rnr_automation")}:${storage.get("rnr_automation_capability")}`);
    }),
    route: vi.fn(async (_pattern: string, handler: (route: FakeRoute) => Promise<void>) => {
      events.push("route");
      routeHandler = handler;
    }),
    on: vi.fn((_event: "page", handler: (page: FakePage) => void) => { pageListeners.push(handler); }),
    pages: () => pages,
  };

  function emitConsoleError(candidate: FakePage, phase: "click" | "wait" | "evaluate") {
    if (options.consoleErrorDuringChat !== phase) return;
    for (const listener of consoleListeners.get(candidate) ?? []) {
      listener({
        type: () => "error",
        text: () => "Application console error",
        location: () => ({ url: "https://rnrgallery.com/app.js" }),
      });
    }
  }

  function makePage(isPopup: boolean): FakePage {
    const frame: FakeFrame = { page: () => candidate };
    const candidate: FakePage = {
      context: () => context,
      mainFrame: () => frame,
      on: (_event, handler) => {
        consoleListeners.set(candidate, [...(consoleListeners.get(candidate) ?? []), handler]);
      },
      goto: async (url: string) => {
        events.push(`goto:${url}`);
        visited.push(url);
        await invoke({ url, resourceType: "document", navigation: true, page: candidate });
        if (!isPopup && visited.length === 1 && options.blockedImageOnFirstGoto) {
          await invoke({
            url: "https://rnrgallery.com/blocked-image.jpg",
            resourceType: "image",
            page: candidate,
          });
        }
        if (!isPopup && visited.length === 1 && options.topLevelNavigationOnFirstGoto) {
          await invoke({
            url: options.topLevelNavigationOnFirstGoto,
            resourceType: "document",
            navigation: true,
            page: candidate,
          });
        }
        if (!isPopup
          && visited.length === 1
          && (options.externalPopupOnFirstGoto || options.popupNavigationOnFirstGoto)) {
          emitPopup();
          await invoke({
            url: options.popupNavigationOnFirstGoto ?? "https://example.com/popup",
            resourceType: "document",
            navigation: true,
            page: popup,
          });
        }
        return { status: () => 200 };
      },
      locator: () => ({ count: async () => options.bodyCount ?? 1 }),
      getByRole: () => ({
        click: async () => {
          events.push("chat");
          emitConsoleError(candidate, "click");
        },
      }),
      waitForTimeout: async () => { emitConsoleError(candidate, "wait"); },
      evaluate: async () => {
        emitConsoleError(candidate, "evaluate");
        return {
          customerChat: options.pollingCounts?.customerChat ?? 0,
          replyAssistant: options.pollingCounts?.replyAssistant ?? 0,
        };
      },
    };
    return candidate;
  }

  const page = makePage(false);
  const popup = makePage(true);
  pages.push(page);

  async function invoke(fixture: Fixture) {
    if (!routeHandler) throw new Error("route handler was not registered");
    const requestPage = fixture.page ?? page;
    const requestFrame = requestPage.mainFrame();
    const route: FakeRoute = {
      request: () => ({
        url: () => fixture.url,
        resourceType: () => fixture.resourceType,
        isNavigationRequest: () => fixture.navigation ?? false,
        frame: () => requestFrame,
      }),
      continue: vi.fn(async () => { continued.push(fixture.url); }),
      abort: vi.fn(async (errorCode?: string) => {
        aborted.push(fixture.url);
        if (["image", "font", "media"].includes(fixture.resourceType)) {
          for (const listener of consoleListeners.get(requestPage) ?? []) {
            listener({
              type: () => "error",
              text: () => errorCode === "blockedbyclient"
                ? "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector"
                : "Failed to load resource: net::ERR_FAILED",
              location: () => ({ url: fixture.url }),
            });
          }
        }
      }),
    };
    await routeHandler(route);
  }

  function emitPopup() {
    pages.push(popup);
    for (const listener of pageListeners) listener(popup);
  }

  return { page, popup, context, events, continued, aborted, visited, invoke, emitPopup };
}

const processStartA = "Mon Aug 31 20:00:00 2026";
const processStartB = "Mon Aug 31 20:00:01 2026";

function processRow(pid: number, ppid: number, startedAt: string, command: string) {
  return `${pid} ${ppid} ${startedAt} ${command}`;
}

describe("Production browser check", () => {
  it("allows only official Production hosts and adds the explicit automation mode", () => {
    expect(buildProductionAutomationUrl("https://rnrgallery.com/shop?utm_source=test").toString())
      .toBe("https://rnrgallery.com/shop?utm_source=test&rnr_automation=1");
    expect(() => buildProductionAutomationUrl("https://preview.example.com/"))
      .toThrow("official Production host");
  });

  it("rejects without RNR_PRODUCTION_SMOKE=1 before invoking the CLI", async () => {
    const deps = dependencies({ env: { RNR_PRODUCTION_SMOKE: "true" } });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).rejects.toThrow("RNR_PRODUCTION_SMOKE=1");
    expect(deps.runCli).not.toHaveBeenCalled();
  });

  it("opens blank before running the program and always closes after a run-code exception", async () => {
    const calls: string[][] = [];
    const deps = dependencies({
      runCli: vi.fn(async (_session, args) => {
        calls.push(args);
        if (args[0] === "run-code") throw new Error("run-code failed");
      }),
    });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).rejects.toThrow("run-code failed");
    expect(calls.map(([command, value]) => [command, value])).toEqual([
      ["open", "about:blank"], ["run-code", expect.any(String)], ["close", undefined],
    ]);
    expect(deps.processList).toHaveBeenCalled();
  });

  it("times out before run-code when the injected clock reaches the deadline and still closes", async () => {
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValueOnce(121_000);
    const deps = dependencies({ now });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).rejects.toThrow("maximum lifetime exceeded");
    expect(deps.runCli).toHaveBeenNthCalledWith(1, expect.any(String), ["open", "about:blank", "--browser", "chrome"], 120_000);
    expect(deps.runCli).toHaveBeenNthCalledWith(2, expect.any(String), ["close"], 10_000);
    expect(deps.processList).toHaveBeenCalled();
  });

  it("closes and validates owned processes after a Playwright assertion failure", async () => {
    const fake = createFakePage({ bodyCount: 0 });
    const deps = dependencies({
      runCli: vi.fn(async (_session, args) => {
        if (args[0] === "run-code") await (0, eval)(`(${args[1]})`)(fake.page);
      }),
    });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).rejects.toThrow("body");
    expect(deps.runCli).toHaveBeenLastCalledWith(expect.any(String), ["close"], 10_000);
    expect(deps.processList).toHaveBeenCalled();
  });

  it("reports zero owned browser processes after successful completion", async () => {
    const fake = createFakePage();
    const deps = dependencies({ runCli: vi.fn(async (_session, args) => {
      if (args[0] === "run-code") {
        const result = await (0, eval)(`(${args[1]})`)(fake.page);
        return `### Result\n${JSON.stringify(result)}`;
      }
    }) });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).resolves.toMatchObject({
      routeCount: 8,
      pollingCounts: { customerChat: 0, replyAssistant: 0 },
      browserProcessesAfterClose: 0,
    });
  });

  it("runs the generated smoke operation when the sandbox has no global URL APIs", async () => {
    const fake = createFakePage();
    const program = buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    });
    const originalUrl = globalThis.URL;
    const originalUrlSearchParams = globalThis.URLSearchParams;
    Object.defineProperty(globalThis, "URL", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "URLSearchParams", { configurable: true, value: undefined });
    try {
      await expect((0, eval)(`(${program})`)(fake.page)).resolves.toMatchObject({
        routeCount: 8,
        unexpectedNavigationCount: 0,
      });
    } finally {
      Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
      Object.defineProperty(globalThis, "URLSearchParams", { configurable: true, value: originalUrlSearchParams });
    }
  });

  it("closes the owned session after a URL-less sandbox run", async () => {
    const fake = createFakePage();
    const calls: string[] = [];
    const deps = dependencies({
      runCli: vi.fn(async (_session, args) => {
        calls.push(args[0]);
        if (args[0] !== "run-code") return undefined;
        const originalUrl = globalThis.URL;
        const originalUrlSearchParams = globalThis.URLSearchParams;
        Object.defineProperty(globalThis, "URL", { configurable: true, value: undefined });
        Object.defineProperty(globalThis, "URLSearchParams", { configurable: true, value: undefined });
        try {
          const result = await (0, eval)(`(${args[1]})`)(fake.page);
          return JSON.stringify(result);
        } finally {
          Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
          Object.defineProperty(globalThis, "URLSearchParams", { configurable: true, value: originalUrlSearchParams });
        }
      }),
    });

    await runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps);
    expect(calls).toEqual(["open", "run-code", "close"]);
    expect(deps.processList).toHaveBeenCalled();
  });

  it("reports bounded sanitized CLI diagnostics without secrets", () => {
    const message = formatPlaywrightCliFailure({
      stage: "run-code",
      exitCode: 7,
      stdout: `DATABASE_URL=postgresql://user:db-password@db.example/prod\nAuthorization: Bearer token-value\n${"x".repeat(6_000)}`,
      stderr: "Cookie: session=customer-cookie\nhttps://user:url-password@rnrgallery.com/",
    });

    expect(message).toContain("stage: run-code");
    expect(message).toContain("exit code: 7");
    expect(message).toContain("stdout:");
    expect(message).toContain("stderr:");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("db-password");
    expect(message).not.toContain("token-value");
    expect(message).not.toContain("customer-cookie");
    expect(message).not.toContain("url-password");
    expect(message.length).toBeLessThan(5_000);
  });

  it("fails closed for absent, malformed, partial, wrong-route-count, and invalid-counter CLI output", async () => {
    const invalidOutputs: ReadonlyArray<readonly [string, unknown]> = [
      ["absent", undefined],
      ["malformed", "not-json"],
      ["partial", JSON.stringify({ routeCount: 8 })],
      ["wrong route count", JSON.stringify(validOperationResult({ routeCount: 7 }))],
      ["fractional counter", JSON.stringify(validOperationResult({ consoleErrorCount: 0.5 }))],
      ["unsafe counter", JSON.stringify(validOperationResult({ consoleErrorCount: Number.MAX_SAFE_INTEGER + 1 }))],
      ["negative blocked counter", JSON.stringify(validOperationResult({ blockedResourceCounts: { image: -1 } }))],
      ["unknown blocked counter", JSON.stringify(validOperationResult({ blockedResourceCounts: { script: 1 } }))],
      ["invalid polling counter", JSON.stringify(validOperationResult({
        pollingCounts: { customerChat: 0, replyAssistant: Number.NaN },
      }))],
    ];

    for (const [label, output] of invalidOutputs) {
      const deps = dependencies({
        runCli: vi.fn(async (_session, args) => args[0] === "run-code" ? output : undefined),
      });
      await expect(
        runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps),
        label,
      ).rejects.toThrow("valid Production browser result");
    }
  });

  it("fails when the CLI result reports any console error", async () => {
    const deps = dependencies({
      runCli: vi.fn(async (_session, args) => args[0] === "run-code"
        ? JSON.stringify(validOperationResult({ consoleErrorCount: 1 }))
        : undefined),
    });

    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps))
      .rejects.toThrow("console error");
  });

  it("returns a privacy-safe owner and ISO start time", async () => {
    await expect(runProductionBrowserCheck({
      url: "https://rnrgallery.com/",
      owner: "release-runner",
    }, dependencies())).resolves.toMatchObject({
      owner: "release-runner",
      startedAt: "1970-01-01T00:00:01.000Z",
    });
  });

  it("rejects an owner label that is not privacy-safe before invoking the CLI", async () => {
    const deps = dependencies();
    await expect(runProductionBrowserCheck({
      url: "https://rnrgallery.com/",
      owner: "operator@example.com",
    }, deps)).rejects.toThrow("privacy-safe owner");
    expect(deps.runCli).not.toHaveBeenCalled();
  });

  it("rejects a duplicate positional URL even when the first equals the default", () => {
    const scriptPath = resolve(process.cwd(), "scripts/production-browser-check.ts");
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      scriptPath,
      "https://rnrgallery.com/",
      "https://rnrgallery.com/",
    ], {
      encoding: "utf8",
      env: { ...process.env, RNR_PRODUCTION_SMOKE: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Only one Production URL may be provided");
  });

  it("matches only the named automation daemon when checking for leaked processes", () => {
    const processes = [
      processRow(123, 1, processStartA, "/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test"),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
      processRow(321, 1, processStartA, "/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test-extra"),
      processRow(456, 1, processStartA, "/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js another-session"),
      processRow(789, 456, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/rnr-production-test-profile"),
    ].join("\n");
    expect(productionBrowserSessionProcessIds(processes, "rnr-production-test")).toEqual([123, 124]);
  });

  it("never signals unrelated session PID 456 while cleaning its owned process tree", async () => {
    const sessionProcesses = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-smoke-${process.pid}-1000-deadbeef`),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
      processRow(456, 1, processStartA, "/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js unrelated-session"),
    ].join("\n");
    const unrelatedOnly = processRow(
      456,
      1,
      processStartA,
      "/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js unrelated-session",
    );
    const processList = vi.fn()
      .mockResolvedValueOnce(sessionProcesses).mockResolvedValueOnce(sessionProcesses)
      .mockResolvedValueOnce(sessionProcesses).mockResolvedValueOnce(sessionProcesses)
      .mockResolvedValue(unrelatedOnly);
    const deps = dependencies({ processList });
    await runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps);
    expect(deps.kill).toHaveBeenCalledWith(124, "SIGTERM");
    expect(deps.kill).toHaveBeenCalledWith(123, "SIGTERM");
    expect(deps.kill).not.toHaveBeenCalledWith(456, expect.anything());
  });

  it("does not signal a reused PID whose start time changed before SIGTERM", async () => {
    const session = `rnr-production-smoke-${process.pid}-1000-deadbeef`;
    const owned = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const reusedChild = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartB, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(reusedChild)
      .mockResolvedValue(reusedChild);
    const deps = dependencies({ processList });

    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps))
      .rejects.toThrow("did not close completely");
    expect(deps.kill).not.toHaveBeenCalledWith(124, expect.anything());
  });

  it("does not adopt a reused tracked PID from the cleanup discovery snapshot", async () => {
    const session = `rnr-production-smoke-${process.pid}-1000-deadbeef`;
    const owned = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const reusedChild = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartB, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(owned)
      .mockResolvedValue(reusedChild);
    const deps = dependencies({ processList });

    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps))
      .rejects.toThrow("did not close completely");
    expect(deps.kill).not.toHaveBeenCalledWith(124, expect.anything());
  });

  it("does not signal a PID whose command changed before SIGTERM", async () => {
    const session = `rnr-production-smoke-${process.pid}-1000-deadbeef`;
    const owned = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const unrelatedChild = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartA, "/usr/local/bin/unrelated"),
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(unrelatedChild)
      .mockResolvedValue(unrelatedChild);
    const deps = dependencies({ processList });

    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps))
      .rejects.toThrow("did not close completely");
    expect(deps.kill).not.toHaveBeenCalledWith(124, expect.anything());
  });

  it("revalidates ancestry immediately before SIGKILL", async () => {
    const session = `rnr-production-smoke-${process.pid}-1000-deadbeef`;
    const owned = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 123, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const reusedChild = [
      processRow(123, 1, processStartA, `/usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js ${session}`),
      processRow(124, 1, processStartA, "/Applications/Google Chrome --user-data-dir=/tmp/profile"),
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(reusedChild)
      .mockResolvedValue(reusedChild);
    const deps = dependencies({ processList });

    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps))
      .rejects.toThrow("did not close completely");
    expect(deps.kill).toHaveBeenCalledWith(124, "SIGTERM");
    expect(deps.kill).not.toHaveBeenCalledWith(124, "SIGKILL");
  });

  it("rejects the actual generated operation when a popup navigates externally during a route", async () => {
    const fake = createFakePage({ externalPopupOnFirstGoto: true });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "DEFAULT", allowMedia: false })})`);

    await expect(operation(fake.page)).rejects.toThrow("unexpected navigation");
    expect(fake.aborted).toContain("https://example.com/popup");
  });

  it.each([
    ["non-HTTPS redirect", "http://rnrgallery.com/help"],
    ["credential-bearing redirect", "https://user:secret@rnrgallery.com/help"],
    ["unauthorized attribution redirect", "https://rnrgallery.com/help?utm_source=redirect"],
  ])("rejects a %s from the context-wide top-level navigation guard", async (_label, redirectUrl) => {
    const fake = createFakePage({ topLevelNavigationOnFirstGoto: redirectUrl });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;

    await expect(operation(fake.page)).rejects.toThrow("unexpected navigation");
    expect(fake.aborted).toContain(redirectUrl);
  });

  it("enforces the full URL policy on popup navigation", async () => {
    const popupUrl = "http://rnrgallery.com/popup";
    const fake = createFakePage({ popupNavigationOnFirstGoto: popupUrl });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;
    await expect(operation(fake.page)).rejects.toThrow("unexpected navigation");
    expect(fake.aborted).toContain(popupUrl);
  });

  it("allows HTTPS credential-free official navigation and ATTRIBUTION query parameters only with that capability", async () => {
    const ordinary = createFakePage();
    const ordinaryOperation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;
    await ordinaryOperation(ordinary.page);
    await ordinary.invoke({
      url: "https://www.rrgallery.co.nz/help",
      resourceType: "document",
      navigation: true,
    });

    const attribution = createFakePage();
    const attributionOperation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/?utm_source=review",
      capability: "ATTRIBUTION",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;
    await attributionOperation(attribution.page);
    await attribution.invoke({
      url: "https://rnrgallery.com/help?gclid=allowed",
      resourceType: "document",
      navigation: true,
    });

    expect(ordinary.continued).toContain("https://www.rrgallery.co.nz/help");
    expect(attribution.continued).toContain("https://rnrgallery.com/help?gclid=allowed");
  });

  it("enforces resource and context-wide navigation policy through the generated operation", async () => {
    const fake = createFakePage();
    const operation = (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "DEFAULT", allowMedia: false })})`);
    await operation(fake.page);
    await fake.invoke({ url: "https://rnrgallery.com/help", resourceType: "document", navigation: true });
    await fake.invoke({ url: "https://example.com/", resourceType: "document", navigation: true });
    await fake.invoke({ url: "https://rnrgallery.com/logo.png", resourceType: "image" });
    await fake.invoke({ url: "https://rnrgallery.com/site.woff2", resourceType: "font" });
    await fake.invoke({ url: "https://rnrgallery.com/demo.mp4", resourceType: "media" });
    fake.emitPopup();
    await fake.invoke({ url: "https://example.com/popup", resourceType: "document", navigation: true, page: fake.popup });
    expect(fake.continued).toContain("https://rnrgallery.com/help");
    expect(fake.aborted).toEqual(expect.arrayContaining([
      "https://example.com/", "https://rnrgallery.com/logo.png", "https://rnrgallery.com/site.woff2", "https://rnrgallery.com/demo.mp4", "https://example.com/popup",
    ]));
  });

  it("rejects an unapproved route even on an official Production host", async () => {
    const fake = createFakePage();
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;
    await operation(fake.page);

    await fake.invoke({
      url: "https://rnrgallery.com/not-approved-for-smoke?rnr_automation=1&rnr_automation_capability=DEFAULT",
      resourceType: "document",
      navigation: true,
    });

    expect(fake.aborted).toContain(
      "https://rnrgallery.com/not-approved-for-smoke?rnr_automation=1&rnr_automation_capability=DEFAULT",
    );
  });

  it("does not count the browser console error caused by its own blocked image", async () => {
    const fake = createFakePage({ blockedImageOnFirstGoto: true });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "DEFAULT",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;

    await expect(operation(fake.page)).resolves.toMatchObject({
      blockedResourceCounts: { image: 1 },
      consoleErrorCount: 0,
    });
  });

  it("allows visual images and fonts, and allows media only when visual media is requested", async () => {
    const visual = createFakePage();
    await (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "VISUAL", allowMedia: false })})`)(visual.page);
    await visual.invoke({ url: "https://rnrgallery.com/logo.png", resourceType: "image" });
    await visual.invoke({ url: "https://rnrgallery.com/site.woff2", resourceType: "font" });
    await visual.invoke({ url: "https://rnrgallery.com/demo.mp4", resourceType: "media" });
    const visualMedia = createFakePage();
    await (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "VISUAL", allowMedia: true })})`)(visualMedia.page);
    await visualMedia.invoke({ url: "https://rnrgallery.com/demo.mp4", resourceType: "media" });
    expect(visual.continued).toEqual(expect.arrayContaining(["https://rnrgallery.com/logo.png", "https://rnrgallery.com/site.woff2"]));
    expect(visual.aborted).toContain("https://rnrgallery.com/demo.mp4");
    expect(visualMedia.continued).toContain("https://rnrgallery.com/demo.mp4");
  });

  it("installs storage markers before the first goto and visits the literal Production route sequence", async () => {
    const fake = createFakePage();
    await (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "ATTRIBUTION", allowMedia: false })})`)(fake.page);
    expect(fake.events.indexOf("storage:1:ATTRIBUTION")).toBeGreaterThanOrEqual(0);
    expect(fake.events.indexOf("route")).toBeLessThan(fake.events.findIndex((event) => event.startsWith("goto:")));
    expect(fake.events.indexOf("storage:1:ATTRIBUTION")).toBeLessThan(fake.events.findIndex((event) => event.startsWith("goto:")));
    expect(fake.visited.map((url) => new URL(url).pathname)).toEqual(["/", "/shop", "/canvas", "/banners", "/design-gallery", "/help", "/account", "/cart"]);
  });

  it("checks homepage Customer Chat polling before later route navigations", async () => {
    const fake = createFakePage({ pollingCounts: { customerChat: 1 } });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({ url: "https://rnrgallery.com/", capability: "DEFAULT", allowMedia: false })})`);

    await expect(operation(fake.page)).rejects.toThrow("polling");
    expect(fake.visited.map((url) => new URL(url).pathname)).toEqual(["/"]);
  });

  it("requires Customer Chat to remain zero in REPLY_ASSISTANT_TEST", async () => {
    const fake = createFakePage({ pollingCounts: { customerChat: 1, replyAssistant: 1 } });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "REPLY_ASSISTANT_TEST",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;

    await expect(operation(fake.page)).rejects.toThrow("customer-service polling");
  });

  it("allows only Reply Assistant polling in REPLY_ASSISTANT_TEST", async () => {
    const fake = createFakePage({ pollingCounts: { replyAssistant: 1 } });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/",
      capability: "REPLY_ASSISTANT_TEST",
      allowMedia: false,
    })})`) as (page: FakePage) => Promise<OperationResult>;

    await expect(operation(fake.page)).resolves.toMatchObject({
      pollingCounts: { customerChat: 0, replyAssistant: 1 },
    });
  });

  it.each(["click", "wait", "evaluate"] as const)(
    "fails when Customer Chat emits a console error during %s",
    async (consoleErrorDuringChat) => {
      const fake = createFakePage({ consoleErrorDuringChat });
      const operation = (0, eval)(`(${buildProductionSmokeProgram({
        url: "https://rnrgallery.com/",
        capability: "DEFAULT",
        allowMedia: false,
      })})`) as (page: FakePage) => Promise<OperationResult>;

      await expect(operation(fake.page)).rejects.toThrow("console error");
    },
  );

  it("retains marker, capability, and authorized attribution parameters on every controlled route when storage is blocked", async () => {
    const fake = createFakePage({ storageBlocked: true });
    const operation = (0, eval)(`(${buildProductionSmokeProgram({
      url: "https://rnrgallery.com/?rnr_automation=1&utm_source=review&fbclid=allowed",
      capability: "ATTRIBUTION",
      allowMedia: false,
    })})`);

    await operation(fake.page);
    for (const visitedUrl of fake.visited) {
      const route = new URL(visitedUrl);
      expect(route.searchParams.get("rnr_automation")).toBe("1");
      expect(route.searchParams.get("rnr_automation_capability")).toBe("ATTRIBUTION");
      expect(route.searchParams.get("utm_source")).toBe("review");
      expect(route.searchParams.get("fbclid")).toBe("allowed");
    }
    expect(fake.visited).toHaveLength(8);
  });

  it("generates distinct internal random session suffixes with one injected clock and exposes no session option", async () => {
    const deps = dependencies({ randomHex: vi.fn().mockReturnValueOnce("11111111").mockReturnValueOnce("22222222") });
    const first = await runProductionBrowserCheck({ url: "https://rnrgallery.com/", session: "attacker" } as Parameters<typeof runProductionBrowserCheck>[0], deps);
    const second = await runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps);
    expect(first.session).toBe(`rnr-production-smoke-${process.pid}-1000-11111111`);
    expect(second.session).toBe(`rnr-production-smoke-${process.pid}-1000-22222222`);
    expect(first.session).not.toContain("attacker");
  });
});
