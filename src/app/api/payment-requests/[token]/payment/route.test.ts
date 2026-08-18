import { describe, expect, it, vi } from "vitest";
import { PaymentRequestConflictError } from "@/server/payment-requests/drizzle-payment-request-repository";
import { createPaymentRequestPaymentRoute } from "./route-handler";

const origin = "https://example.test";
const token = "A".repeat(43);
function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/payment-requests/${token}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: requestOrigin, "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site" },
    body: JSON.stringify(body),
  });
}

describe("payment request start", () => {
  it("starts Card without requiring an address and accepts no financial client fields", async () => {
    const start = vi.fn().mockResolvedValue({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "redirect", method: "card", redirectUrl: "https://checkout.stripe.test" },
    });
    const route = createPaymentRequestPaymentRoute({ publicByToken: vi.fn().mockResolvedValue({ status: "pending" }), start, origin });
    const body = { method: "card", fullName: "Customer", email: "payer@example.test", idempotencyKey: "public-payment-1" };
    const response = await route.POST(request(body), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledWith(token, expect.objectContaining(body));
  });

  it("rejects forged financial fields and cross-origin starts", async () => {
    const start = vi.fn();
    const route = createPaymentRequestPaymentRoute({ publicByToken: vi.fn().mockResolvedValue({ status: "pending" }), start, origin });
    const body = { method: "card", fullName: "Customer", email: "payer@example.test", idempotencyKey: "public-payment-2", amountCents: 1 };
    expect((await route.POST(request(body), { params: Promise.resolve({ token }) })).status).toBe(400);
    expect((await route.POST(request(body, "https://attacker.example"), { params: Promise.resolve({ token }) })).status).toBe(403);
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 409 when a fresh server balance check invalidates the request", async () => {
    const route = createPaymentRequestPaymentRoute({
      publicByToken: vi.fn().mockResolvedValue({ status: "pending" }),
      start: vi.fn().mockRejectedValue(new PaymentRequestConflictError()), origin,
    });
    expect((await route.POST(request({ method: "card", fullName: "Customer", email: "payer@example.test", idempotencyKey: "public-payment-3" }), { params: Promise.resolve({ token }) })).status).toBe(409);
  });
});
