import { describe, expect, it, vi } from "vitest";

import {
  buildProductionAutomationUrl,
  productionBrowserSessionProcessIds,
  runProductionBrowserCheck,
  type ProductionBrowserCheckDependencies,
} from "./production-browser-check";

function dependencies(overrides: Partial<ProductionBrowserCheckDependencies> = {}) {
  return {
    runCli: vi.fn().mockResolvedValue(undefined),
    processList: vi.fn().mockResolvedValue(""),
    kill: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(1_000),
    ...overrides,
  } satisfies ProductionBrowserCheckDependencies;
}

describe("Production browser check", () => {
  it("allows only official Production hosts and adds the explicit automation mode", () => {
    expect(buildProductionAutomationUrl("https://rnrgallery.com/shop?utm_source=test").toString())
      .toBe("https://rnrgallery.com/shop?utm_source=test&rnr_automation=1");
    expect(() => buildProductionAutomationUrl("https://preview.example.com/"))
      .toThrow("official Production host");
  });

  it("always closes the unique browser session when a verification command fails", async () => {
    const calls: string[][] = [];
    const deps = dependencies({
      runCli: vi.fn(async (_session, args) => {
        calls.push(args);
        if (args[0] === "eval") throw new Error("verification failed");
      }),
    });

    await expect(runProductionBrowserCheck({
      url: "https://rnrgallery.com/",
      session: "rnr-production-test",
    }, deps)).rejects.toThrow("verification failed");

    expect(calls.map(([command]) => command)).toEqual(["open", "eval", "close"]);
    expect(deps.processList).toHaveBeenCalled();
  });

  it("matches only the named automation daemon when checking for leaked processes", () => {
    const processes = [
      "123  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test",
      "124  123  /Applications/Google Chrome --user-data-dir=/tmp/profile",
      "321  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test-extra",
      "456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js another-session",
      "789  456  /Applications/Google Chrome --user-data-dir=/tmp/rnr-production-test-profile",
    ].join("\n");

    expect(productionBrowserSessionProcessIds(processes, "rnr-production-test"))
      .toEqual([123, 124]);
  });

  it("terminates only its tracked process tree if the CLI close leaves it behind", async () => {
    const sessionProcesses = [
      "123  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js rnr-production-test",
      "124  123  /Applications/Google Chrome --user-data-dir=/tmp/profile",
      "456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js other-work",
    ].join("\n");
    const processList = vi.fn()
      .mockResolvedValueOnce(sessionProcesses)
      .mockResolvedValueOnce(sessionProcesses)
      .mockResolvedValueOnce("456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js other-work")
      .mockResolvedValueOnce("456  1  /usr/local/bin/node /tmp/playwright-core/lib/entry/cliDaemon.js other-work");
    const deps = dependencies({ processList });

    await expect(runProductionBrowserCheck({
      url: "https://rnrgallery.com/",
      session: "rnr-production-test",
    }, deps)).resolves.toMatchObject({ browserProcessesAfterClose: 0 });

    expect(deps.kill).toHaveBeenCalledWith(124, "SIGTERM");
    expect(deps.kill).toHaveBeenCalledWith(123, "SIGTERM");
    expect(deps.kill).not.toHaveBeenCalledWith(456, expect.anything());
  });
});
