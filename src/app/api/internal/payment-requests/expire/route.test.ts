import { describe, expect, it, vi } from "vitest";
import { createPaymentRequestExpiryRoute } from "./route-handler";

describe("payment request expiry cron", () => {
  it("requires the existing cron secret before accessing payments", async () => {
    const expire = vi.fn();
    const reconcile = vi.fn();
    const handler = createPaymentRequestExpiryRoute({ secret: "test-secret", expire, reconcile });
    expect((await handler(new Request("https://example.test/expire"))).status).toBe(401);
    expect(expire).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("converges safe expiry before and after authoritative reconciliation", async () => {
    const calls: string[] = [];
    const handler = createPaymentRequestExpiryRoute({ secret: "test-secret", expire: async () => { calls.push("expire"); return 1; }, reconcile: async () => { calls.push("reconcile"); } });
    const response = await handler(new Request("https://example.test/expire", { headers: { Authorization: "Bearer test-secret" } }));
    expect(response.status).toBe(200);
    expect(calls).toEqual(["expire", "reconcile", "expire"]);
    expect(await response.json()).toEqual({ cancelled: 2 });
  });
});
