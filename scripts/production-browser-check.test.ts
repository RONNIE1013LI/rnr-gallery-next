import { describe, expect, it, vi } from "vitest";

import {
  buildProductionAutomationUrl,
  buildProductionSmokeProgram,
  productionBrowserSessionProcessIds,
  runProductionBrowserCheck,
  type ProductionBrowserCheckDependencies,
} from "./production-browser-check";

function dependencies(overrides: Partial<ProductionBrowserCheckDependencies> = {}) {
  return {
    env: { RNR_PRODUCTION_SMOKE: "1" },
    runCli: vi.fn().mockResolvedValue(undefined),
    processList: vi.fn().mockResolvedValue(""),
    kill: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(1_000),
    randomHex: vi.fn().mockReturnValue("deadbeef"),
    ...overrides,
  } satisfies ProductionBrowserCheckDependencies;
}

type Fixture = Readonly<{
  url: string;
  resourceType: string;
  navigation?: boolean;
  page?: ReturnType<typeof createFakePage>["page"];
}>;

function createFakePage(options: Readonly<{ bodyCount?: number; polling?: number }> = {}) {
  const events: string[] = [];
  const continued: string[] = [];
  const aborted: string[] = [];
  const visited: string[] = [];
  let routeHandler: ((route: any) => Promise<void>) | undefined;
  const contextListeners = new Map<string, Array<(value: any) => void>>();
  const pages: any[] = [];

  const context = {
    addInitScript: vi.fn(async (script: (input: any) => void, input: any) => {
      events.push("init");
      const original = (globalThis as { sessionStorage?: unknown }).sessionStorage;
      const storage = new Map<string, string>();
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: { setItem: (key: string, value: string) => storage.set(key, value) },
      });
      try {
        script(input);
      } finally {
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: original });
      }
      events.push(`storage:${storage.get("rnr_automation")}:${storage.get("rnr_automation_capability")}`);
    }),
    route: vi.fn(async (_pattern: string, handler: (route: any) => Promise<void>) => {
      events.push("route");
      routeHandler = handler;
    }),
    on: vi.fn((event: string, handler: (value: any) => void) => {
      contextListeners.set(event, [...(contextListeners.get(event) ?? []), handler]);
    }),
    pages: () => pages,
  };

  const page = {
    context: () => context,
    mainFrame: () => frame,
    on: vi.fn(),
    goto: vi.fn(async (url: string) => {
      events.push(`goto:${url}`);
      visited.push(url);
      await invoke({ url, resourceType: "document", navigation: true, page });
      return { status: () => 200 };
    }),
    locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(options.bodyCount ?? 1) })),
    getByRole: vi.fn(() => ({ click: vi.fn(async () => events.push("chat")) })),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ customerChat: options.polling ?? 0, replyAssistant: 0 }),
  };
  const frame = { page: () => page };
  pages.push(page);

  const popupFrame = { page: () => popup };
  const popup = { ...page, mainFrame: () => popupFrame };

  async function invoke(fixture: Fixture) {
    if (!routeHandler) throw new Error("route handler was not registered");
    const requestPage = fixture.page ?? page;
    const requestFrame = requestPage === popup ? popupFrame : frame;
    const route = {
      request: () => ({
        url: () => fixture.url,
        resourceType: () => fixture.resourceType,
        isNavigationRequest: () => fixture.navigation ?? false,
        frame: () => requestFrame,
      }),
      continue: vi.fn(async () => continued.push(fixture.url)),
      abort: vi.fn(async () => aborted.push(fixture.url)),
    };
    await routeHandler(route);
  }

  function emitPopup() {
    pages.push(popup);
    for (const listener of contextListeners.get("page") ?? []) listener(popup);
  }

  return { page, context, events, continued, aborted, visited, invoke, emitPopup };
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
        return `Playwright complete\n${JSON.stringify({ rnrProductionBrowserCheck: result })}`;
      }
    }) });
    await expect(runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps)).resolves.toMatchObject({
      routeCount: 8,
      pollingCounts: { customerChat: 0, replyAssistant: 0 },
      browserProcessesAfterClose: 0,
    });
  });

  it("matches only the named automation daemon when checking for leaked processes", () => {
    const processes = [
      "123  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test",
      "124  123  /Applications/Google Chrome --user-data-dir=/tmp/profile",
      "321  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test-extra",
      "456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js another-session",
      "789  456  /Applications/Google Chrome --user-data-dir=/tmp/rnr-production-test-profile",
    ].join("\n");
    expect(productionBrowserSessionProcessIds(processes, "rnr-production-test")).toEqual([123, 124]);
  });

  it("never signals unrelated session PID 456 while cleaning its owned process tree", async () => {
    const sessionProcesses = [
      `123  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-smoke-${process.pid}-1000-deadbeef`,
      "124  123  /Applications/Google Chrome --user-data-dir=/tmp/profile",
      "456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js unrelated-session",
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(sessionProcesses).mockResolvedValueOnce(sessionProcesses)
      .mockResolvedValueOnce("456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js unrelated-session")
      .mockResolvedValueOnce("456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js unrelated-session");
    const deps = dependencies({ processList });
    await runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps);
    expect(deps.kill).toHaveBeenCalledWith(124, "SIGTERM");
    expect(deps.kill).toHaveBeenCalledWith(123, "SIGTERM");
    expect(deps.kill).not.toHaveBeenCalledWith(456, expect.anything());
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
    await fake.invoke({ url: "https://example.com/popup", resourceType: "document", navigation: true, page: (fake.context.pages() as any[])[1] });
    expect(fake.continued).toContain("https://rnrgallery.com/help");
    expect(fake.aborted).toEqual(expect.arrayContaining([
      "https://example.com/", "https://rnrgallery.com/logo.png", "https://rnrgallery.com/site.woff2", "https://rnrgallery.com/demo.mp4", "https://example.com/popup",
    ]));
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

  it("generates distinct internal random session suffixes with one injected clock and exposes no session option", async () => {
    const deps = dependencies({ randomHex: vi.fn().mockReturnValueOnce("11111111").mockReturnValueOnce("22222222") });
    const first = await runProductionBrowserCheck({ url: "https://rnrgallery.com/", session: "attacker" } as Parameters<typeof runProductionBrowserCheck>[0], deps);
    const second = await runProductionBrowserCheck({ url: "https://rnrgallery.com/" }, deps);
    expect(first.session).toBe(`rnr-production-smoke-${process.pid}-1000-11111111`);
    expect(second.session).toBe(`rnr-production-smoke-${process.pid}-1000-22222222`);
    expect(first.session).not.toContain("attacker");
  });
});
