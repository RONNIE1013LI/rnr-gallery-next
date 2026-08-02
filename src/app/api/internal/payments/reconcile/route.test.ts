import { describe, expect, it, vi } from "vitest";
import {
  createPaymentReconciliationRoute,
  timingSafeSecretEqual,
} from "./route";

const url = "https://shop.example.test/api/internal/payments/reconcile";
const summary = {
  processed: 2,
  applied: 1,
  retried: 0,
  pending: 1,
  failed: 0,
};

function request(authorization?: string, body?: BodyInit) {
  return new Request(url, {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
    body,
  });
}

describe("POST /api/internal/payments/reconcile", () => {
  it("returns 503 when the server-only reconciliation secret is not configured", async () => {
    const reconcilePendingPayments = vi.fn();
    const handler = createPaymentReconciliationRoute({
      reconciliationSecret: null,
      paymentService: { reconcilePendingPayments },
    });

    const response = await handler(request("Bearer supplied-secret"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "RECONCILIATION_UNAVAILABLE",
        message: "Payment reconciliation is unavailable",
      },
    });
    expect(reconcilePendingPayments).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["wrong scheme", "Basic correct-secret"],
    ["missing token", "Bearer"],
    ["wrong token", "Bearer wrong-secret"],
    ["extra token", "Bearer correct-secret extra"],
    ["comma joined", "Bearer correct-secret,Bearer other"],
  ])("rejects %s authorization without starting reconciliation", async (_name, authorization) => {
    const reconcilePendingPayments = vi.fn();
    const handler = createPaymentReconciliationRoute({
      reconciliationSecret: "correct-secret",
      paymentService: { reconcilePendingPayments },
    });

    const response = await handler(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
    expect(reconcilePendingPayments).not.toHaveBeenCalled();
  });

  it("compares unequal secret lengths safely", () => {
    expect(() => timingSafeSecretEqual("short", "a-much-longer-secret"))
      .not.toThrow();
    expect(timingSafeSecretEqual("short", "a-much-longer-secret")).toBe(false);
    expect(timingSafeSecretEqual("same-secret", "same-secret")).toBe(true);
  });

  it.each([
    ["JSON", "{}"],
    ["whitespace", " "],
  ])("rejects a non-empty %s body before processing", async (_name, body) => {
    const reconcilePendingPayments = vi.fn();
    const handler = createPaymentReconciliationRoute({
      reconciliationSecret: "correct-secret",
      paymentService: { reconcilePendingPayments },
    });

    const response = await handler(request("Bearer correct-secret", body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Request body must be empty" },
    });
    expect(reconcilePendingPayments).not.toHaveBeenCalled();
  });

  it("accepts an empty body and returns only safe aggregate counts", async () => {
    const reconcilePendingPayments = vi.fn().mockResolvedValue({
      ...summary,
      providerReference: "must-not-leak",
      orderNumber: "must-not-leak",
    });
    const handler = createPaymentReconciliationRoute({
      reconciliationSecret: "correct-secret",
      paymentService: { reconcilePendingPayments },
    });

    const response = await handler(request("Bearer correct-secret", ""));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(summary);
    expect(reconcilePendingPayments).toHaveBeenCalledOnce();
  });

  it("isolates internal errors behind a safe response", async () => {
    const reconcilePendingPayments = vi.fn()
      .mockRejectedValue(new Error("private provider reference and secret"));
    const handler = createPaymentReconciliationRoute({
      reconciliationSecret: "correct-secret",
      paymentService: { reconcilePendingPayments },
    });

    const response = await handler(request("Bearer correct-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "RECONCILIATION_FAILED",
        message: "Payment reconciliation could not be completed",
      },
    });
  });
});
