import { describe, expect, it, vi } from "vitest";
import { createPublicPaymentRequestRoute } from "./route-handler";

const token = "A".repeat(43);
const dto = {
  requestNumber: "PAY-2026-ABC123", kind: "standalone" as const,
  description: "Custom deposit", amountCents: 20_000, currency: "NZD" as const,
  status: "pending" as const, methods: ["card" as const],
};

describe("public payment request details", () => {
  it("returns only the public allowlist and private no-store headers", async () => {
    const route = createPublicPaymentRequestRoute({ publicByToken: vi.fn().mockResolvedValue(dto) });
    const response = await route.GET(new Request(`https://example.test/api/payment-requests/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const body = await response.json();
    expect(body).toEqual({ request: dto });
    expect(JSON.stringify(body)).not.toMatch(/customerEmail|customerName|internalNote|publicTokenDigest/);
  });

  it.each(["short", "B".repeat(43)])("returns the same 404 for unavailable token %s", async (value) => {
    const route = createPublicPaymentRequestRoute({ publicByToken: vi.fn().mockResolvedValue(null) });
    const response = await route.GET(new Request(`https://example.test/api/payment-requests/${value}`), {
      params: Promise.resolve({ token: value }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Payment request is unavailable" });
  });
});
