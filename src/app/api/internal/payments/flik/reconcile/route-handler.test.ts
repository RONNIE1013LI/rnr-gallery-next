import { describe, it, expect, vi } from "vitest";
import { createFlikReconciliationRoute } from "./route-handler";
describe("Flik reconciliation authentication", () => {
  it("rejects missing or wrong cron credentials before work", async () => {
    const run = vi.fn(); const handler = createFlikReconciliationRoute({ secret: "test-cron", run });
    for (const authorization of ["", "Bearer wrong"]) {
      expect((await handler(new Request("https://shop.example.test/api/internal/payments/flik/reconcile", { headers: { authorization } }))).status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it("runs only with the configured cron credential", async () => {
    const run = vi.fn().mockResolvedValue({ processed: 1 });
    const response = await createFlikReconciliationRoute({ secret: "test-cron", run })(new Request("https://shop.example.test/api/internal/payments/flik/reconcile", { headers: { authorization: "Bearer test-cron" } }));
    expect(response.status).toBe(200); expect(run).toHaveBeenCalledOnce();
  });
});

const isolated = vi.hoisted(() => ({ tasks: [] as Array<() => Promise<void>>, wise: vi.fn(), flik: vi.fn() }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => isolated.tasks.push(task) }));
vi.mock("@/server/payments/flik-runtime", () => ({ createFlikRuntime: async () => ({}) }));
vi.mock("@/server/payments/flik-reconciliation-runtime", () => ({ createFlikReconciliationWorker: () => ({ run: isolated.flik }) }));
vi.mock("@/server/payments/wise-payid-runtime", () => ({ createWisePayIdRuntime: () => ({ worker: { run: isolated.wise } }) }));

describe("shared schedule failure isolation", () => {
  it("preserves the Flik response when the later Wise task fails", async () => {
    vi.stubEnv("CRON_SECRET", "fixture-cron"); vi.stubEnv("ENABLE_WISE_PAYID", "true");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    isolated.tasks.length = 0;
    isolated.flik.mockResolvedValue({ processed: 3 });
    isolated.wise.mockRejectedValue(new Error("private-provider-fixture"));
    try {
      const response = await createFlikReconciliationRoute()(new Request("https://shop.example.test/api/internal/payments/flik/reconcile", { headers: { authorization: "Bearer fixture-cron" } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ processed: 3 });
      expect(isolated.tasks).toHaveLength(1);
      await expect(isolated.tasks[0]()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith("Wise statement reconciliation unavailable; orders remain pending");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-provider-fixture");
    } finally { warning.mockRestore(); vi.unstubAllEnvs(); }
  });
});

 it("starts Wise while a slow Flik run is still pending", async () => {
   vi.stubEnv("CRON_SECRET", "fixture-cron"); vi.stubEnv("ENABLE_WISE_PAYID", "true");
   let finish!: (value: unknown) => void;
   isolated.flik.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
   isolated.wise.mockResolvedValue({ applied: 0 }); isolated.wise.mockClear(); isolated.tasks.length = 0;
   try {
     const pending = createFlikReconciliationRoute()(new Request("https://shop.example.test/api/internal/payments/flik/reconcile", { headers: { authorization: "Bearer fixture-cron" } }));
     await vi.waitFor(() => expect(isolated.wise).toHaveBeenCalledOnce());
     finish({ processed: 1 });
     expect((await pending).status).toBe(200);
     await isolated.tasks[0]();
   } finally { finish?.({ processed: 1 }); vi.unstubAllEnvs(); }
 });
