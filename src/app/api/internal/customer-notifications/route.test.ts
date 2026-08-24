import { describe, expect, it, vi } from "vitest";
import { createCustomerNotificationCronRoute } from "./route-handler";

const url = "https://shop.example.test/api/internal/customer-notifications";

function request(authorization?: string) {
  return new Request(url, {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/internal/customer-notifications", () => {
  it("is unavailable when the server-only secret is not configured", async () => {
    const deliverPending = vi.fn();
    const handler = createCustomerNotificationCronRoute({ secret: null, deliverPending });

    const response = await handler(request("Bearer supplied-secret"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deliverPending).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "Basic correct-secret",
    "Bearer wrong-secret",
    "Bearer correct-secret extra",
  ])("rejects invalid authorization %s", async (authorization) => {
    const deliverPending = vi.fn();
    const handler = createCustomerNotificationCronRoute({
      secret: "correct-secret",
      deliverPending,
    });

    const response = await handler(request(authorization));

    expect(response.status).toBe(401);
    expect(deliverPending).not.toHaveBeenCalled();
  });

  it("processes only the bounded notification batch", async () => {
    const deliverPending = vi.fn().mockResolvedValue({
      result: "processed",
      sent: 3,
      failed: 1,
      recipientEmail: "must-not-leak@example.test",
      providerError: "private provider data",
    });
    const handler = createCustomerNotificationCronRoute({
      secret: "correct-secret",
      deliverPending,
    });

    const response = await handler(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "processed", sent: 3, failed: 1 });
    expect(deliverPending).toHaveBeenCalledWith(20);
  });

  it("returns a safe unavailable response when every runtime is not configured", async () => {
    const deliverPending = vi.fn().mockResolvedValue({
      result: "not_configured",
      sent: 0,
      failed: 0,
      recipientEmail: "must-not-leak@example.test",
      providerError: "private provider data",
    });
    const handler = createCustomerNotificationCronRoute({
      secret: "correct-secret",
      deliverPending,
    });

    const response = await handler(request("Bearer correct-secret"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "NOTIFICATION_RETRY_UNAVAILABLE",
        message: "Customer notification retry is unavailable",
      },
    });
  });

  it("does not expose internal delivery errors", async () => {
    const deliverPending = vi.fn().mockRejectedValue(new Error("private provider data"));
    const handler = createCustomerNotificationCronRoute({
      secret: "correct-secret",
      deliverPending,
    });

    const response = await handler(request("Bearer correct-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "NOTIFICATION_RETRY_FAILED", message: "Customer notifications could not be processed" },
    });
  });
});
