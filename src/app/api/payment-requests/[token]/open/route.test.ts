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


describe("production payment activation origins", () => {
  it.each(["rnrgallery.com", "www.rnrgallery.com", "rrgallery.co.nz", "www.rrgallery.co.nz"])("allows same-origin JSON activation on %s", async (host) => {
    const activateByToken = vi.fn(async () => null);
    const route = createPaymentRequestOpenRoute({ origin: "https://rnrgallery.com", activateByToken });
    const response = await route(new Request(`https://${host}/api/payment-requests/token/open`, {
      method: "POST", headers: { Origin: `https://${host}`, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}",
    }), context);
    expect(response.status).toBe(404);
    expect(activateByToken).toHaveBeenCalledOnce();
  });
  it.each([
    ["https://evil.test", "https://evil.test", "same-origin"],
    ["https://rrgallery.co.nz", "https://evil.test", "same-origin"],
    ["https://rrgallery.co.nz", "https://rrgallery.co.nz", "cross-site"],
    ["https://rrgallery.co.nz", "https://www.rrgallery.co.nz", "same-site"],
  ])("rejects untrusted or cross-origin activation %s %s %s", async (target, source, site) => {
    const activateByToken = vi.fn();
    const route = createPaymentRequestOpenRoute({ origin: "https://rnrgallery.com", activateByToken });
    const response = await route(new Request(`${target}/api/payment-requests/token/open`, { method: "POST", headers: { Origin: source, "Sec-Fetch-Site": site, "Content-Type": "application/json" }, body: "{}" }), context);
    expect(response.status).toBe(403);
    expect(activateByToken).not.toHaveBeenCalled();
  });
});
