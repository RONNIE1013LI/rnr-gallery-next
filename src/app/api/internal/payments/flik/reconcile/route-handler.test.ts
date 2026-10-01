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
