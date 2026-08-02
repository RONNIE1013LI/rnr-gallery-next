import { describe, expect, it, vi } from "vitest";
import type { CheckoutStateRepository } from "@/server/checkout/checkout-repository";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";
import { InvalidCheckoutStateError } from "@/server/checkout/checkout-service";
import { createCheckoutSessionRoute } from "./route";

const origin = "https://shop.example.test";
const sessionId = "10000000-0000-4000-8000-000000000001";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function repository(): CheckoutStateRepository {
  return {
    findActiveSessionByTokenDigest: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({
      id: sessionId,
      tokenDigest: "digest",
      customerId: null,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    deleteEmptySession: vi.fn().mockResolvedValue(true),
    createUpload: vi.fn(),
    findOwnedUploadIds: vi.fn(),
    saveCheckoutState: vi.fn(),
    getCheckoutState: vi.fn(),
    clearSelectedShippingQuote: vi.fn(),
    persistAndSelectShippingQuote: vi.fn(),
  };
}

describe("POST /api/checkout/session", () => {
  it("creates a session, delegates authoritative update and returns its opaque cookie", async () => {
    const repo = repository();
    const state = { id: sessionId, version: 2, cartDigest: "a".repeat(64) };
    const service = { updateSession: vi.fn().mockResolvedValue(state) };
    const handler = createCheckoutSessionRoute({
      repository: repo,
      checkoutService: service,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      createToken: () => "new-token",
      environment: "production",
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });
    const input = { cart: {}, billingAddress: {}, deliveryMethod: "post" };

    const response = await handler(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ checkout: state });
    expect(service.updateSession).toHaveBeenCalledWith(sessionId, input);
    expect(response.headers.get("Set-Cookie")).toContain("rnr_checkout_session=new-token");
  });

  it("rejects invalid JSON and cross-site requests before creating a session", async () => {
    for (const invalidRequest of [request("{"), request({}, "https://attacker.example")]) {
      const repo = repository();
      const handler = createCheckoutSessionRoute({
        repository: repo,
        checkoutService: { updateSession: vi.fn() },
        getOptionalSession: async () => null,
        trustedOrigin: origin,
      });
      expect((await handler(invalidRequest)).status).toBeGreaterThanOrEqual(400);
      expect(repo.createSession).not.toHaveBeenCalled();
    }
  });

  it("removes only a newly-created empty session when canonical validation fails", async () => {
    const repo = repository();
    const handler = createCheckoutSessionRoute({
      repository: repo,
      checkoutService: {
        updateSession: vi.fn().mockRejectedValue(new InvalidCheckoutCartError("bad cart")),
      },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      createToken: () => "new-token",
    });

    expect((await handler(request({ cart: {} }))).status).toBe(422);
    expect(repo.deleteEmptySession).toHaveBeenCalledWith(sessionId);
  });

  it("returns validation feedback for an invalid checkout state", async () => {
    const repo = repository();
    const handler = createCheckoutSessionRoute({
      repository: repo,
      checkoutService: {
        updateSession: vi.fn().mockRejectedValue(new InvalidCheckoutStateError("bad delivery method")),
      },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      createToken: () => "new-token",
    });

    const response = await handler(request({ cart: {}, deliveryMethod: "courier" }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "bad delivery method" },
    });
  });
});
