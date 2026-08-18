import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { PaymentRequestConflictError } from "@/server/payment-requests/drizzle-payment-request-repository";
import { createAdminPaymentRequestsRoute } from "./route-handler";

const origin = "http://localhost:3000";
const result = {
  request: {
    id: "ef0fa975-2050-4c43-b693-38367b1b663e",
    requestNumber: "PAY-2026-ABC123",
    kind: "standalone" as const,
    description: "Custom deposit",
    amountCents: 20_000,
    currency: "NZD" as const,
    status: "pending" as const,
    methods: ["card" as const],
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  },
  rawToken: "A".repeat(43),
};

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin payment requests route", () => {
  it("requires manage_payment before reading or creating", async () => {
    const create = vi.fn();
    const route = createAdminPaymentRequestsRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      create,
      origin,
    });
    const response = await route.POST(request({}));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a fixed request and returns its raw link token only on first creation", async () => {
    const create = vi.fn().mockResolvedValue(result);
    const route = createAdminPaymentRequestsRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      create,
      origin,
    });
    const body = {
      kind: "standalone",
      idempotencyKey: "payment-request-create-1",
      amountCents: 20_000,
      currency: "NZD",
      description: "Custom deposit",
      enabledPaymentMethods: ["card"],
    };
    const response = await route.POST(request(body));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("admin-1", body);
    await expect(response.json()).resolves.toEqual({
      request: result.request,
      paymentUrl: `${origin}/pay/${result.rawToken}`,
    });
  });

  it("returns an idempotent replay without exposing a replacement token", async () => {
    const create = vi.fn().mockResolvedValue({ request: result.request });
    const route = createAdminPaymentRequestsRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      create,
      origin,
    });
    const response = await route.POST(request({
      kind: "standalone",
      idempotencyKey: "payment-request-create-replay",
      amountCents: 20_000,
      currency: "NZD",
      description: "Custom deposit",
      enabledPaymentMethods: ["card"],
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ request: result.request });
  });

  it("rejects cross-origin and conflicting requests", async () => {
    const create = vi.fn().mockRejectedValue(new PaymentRequestConflictError());
    const route = createAdminPaymentRequestsRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      create,
      origin,
    });
    expect((await route.POST(request({}, "https://attacker.example"))).status).toBe(403);
    expect((await route.POST(request({}))).status).toBe(409);
  });
});
