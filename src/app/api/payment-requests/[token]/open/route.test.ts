import { describe, expect, it, vi } from "vitest";
import { createPaymentRequestOpenRoute } from "./route-handler";

const origin = "https://example.test";
const context = { params: Promise.resolve({ token: "a".repeat(43) }) };

describe("payment link activation route", () => {
  it("rejects cross-site activation before touching the database", async () => {
    const activateByToken = vi.fn();
    const route = createPaymentRequestOpenRoute({ origin, activateByToken });
    const response = await route(new Request(`${origin}/api/payment-requests/token/open`, { method: "POST", headers: { Origin: "https://other.test", "Sec-Fetch-Site": "cross-site" } }), context);
    expect(response.status).toBe(403);
    expect(activateByToken).not.toHaveBeenCalled();
  });

  it("returns the stable deadline and DB time without payment side effects", async () => {
    const dto = { requestNumber: "PAY-TEST", kind: "standalone" as const, description: "Test", amountCents: 2000, currency: "NZD" as const, status: "pending" as const, methods: ["card"] as const, expiresAt: "2026-09-26T12:00:00Z", serverNow: "2026-09-26T00:00:00Z" };
    const activateByToken = vi.fn(async () => dto);
    const route = createPaymentRequestOpenRoute({ origin, activateByToken });
    for (let index = 0; index < 2; index++) {
      const response = await route(new Request(`${origin}/api/payment-requests/token/open`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" } }), context);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ request: dto });
    }
  });
});
