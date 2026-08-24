import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import {
  InternalNotificationRecipientConflictError,
  InternalNotificationRecipientNotFoundError,
  InternalNotificationRecipientValidationError,
  type InternalNotificationRecipientView,
} from "@/server/notifications/internal-notification-recipient-service";
import { createAdminNotificationRecipientVerificationRoute } from "./route-handler";

const { defaultRequirePermission, runtimeGetter } = vi.hoisted(() => ({
  defaultRequirePermission: vi.fn(),
  runtimeGetter: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", () => ({
  requireAdminPermission: defaultRequirePermission,
}));
vi.mock("@/server/notifications/internal-notification-recipient-runtime", () => ({
  getInternalNotificationRecipientRuntime: runtimeGetter,
}));

const origin = "http://localhost:3000";
const recipientId = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ recipientId }) };

function recipient(): InternalNotificationRecipientView {
  return {
    id: recipientId,
    email: "ops@example.test",
    status: "pending_verification",
    topics: ["proof_approved"],
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    verifiedAt: null,
    verificationExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
    disabledAt: null,
  };
}

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/notification-recipients/${recipientId}/verification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requirePermission: vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    }),
    resendVerification: vi.fn().mockResolvedValue({
      recipient: recipient(),
      verificationDelivery: "sent",
    }),
    trustedOrigin: origin,
    ...overrides,
  };
}

describe("Admin notification recipient verification route", () => {
  beforeEach(() => {
    defaultRequirePermission.mockReset();
    runtimeGetter.mockReset();
  });

  it("maps default runtime initialization failures to a no-store 500", async () => {
    defaultRequirePermission.mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    runtimeGetter.mockImplementation(() => {
      throw new Error("private runtime configuration failure");
    });

    const response = await createAdminNotificationRecipientVerificationRoute().POST(
      request({ idempotencyKey: "recipient-resend-runtime-failure" }),
      context,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Verification could not be resent.",
    });
  });

  it("reissues verification for the path recipient and returns provider outcome safely", async () => {
    const resendVerification = vi.fn().mockResolvedValue({
      recipient: recipient(),
      verificationDelivery: "not_configured",
    });
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    const route = createAdminNotificationRecipientVerificationRoute(dependencies({
      resendVerification,
      requirePermission,
    }));

    const response = await route.POST(request({
      recipientId: "20000000-0000-4000-8000-000000000002",
      idempotencyKey: "recipient-resend-1",
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(resendVerification).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      { recipientId, idempotencyKey: "recipient-resend-1" },
    );
    const body = await response.json();
    expect(body).toEqual({
      recipient: expect.objectContaining({ id: recipientId }),
      verificationDelivery: "not_configured",
    });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("rejects Staff, cross-origin, malformed, and oversized resend requests", async () => {
    const resendVerification = vi.fn();
    const denied = createAdminNotificationRecipientVerificationRoute(dependencies({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      resendVerification,
    }));
    const route = createAdminNotificationRecipientVerificationRoute(dependencies({ resendVerification }));

    expect((await denied.POST(request({}), context)).status).toBe(403);
    expect((await route.POST(request({}, "https://attacker.example"), context)).status).toBe(403);
    expect((await route.POST(new Request(`${origin}/api/admin/notification-recipients/${recipientId}/verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
      body: "{",
    }), context)).status).toBe(400);
    expect((await route.POST(request({ idempotencyKey: "x".repeat(17_000) }), context)).status).toBe(413);
    expect(resendVerification).not.toHaveBeenCalled();
  });

  it.each([
    [new HttpError("Unauthorized", 401), 401, "Unauthorized"],
    [new InternalNotificationRecipientValidationError("private validation"), 422, "Invalid notification recipient input"],
    [new InternalNotificationRecipientNotFoundError("private missing"), 404, "Notification recipient not found"],
    [new InternalNotificationRecipientConflictError("private stale state"), 409, "The notification recipient changed. Refresh and try again."],
    [new Error("provider secret"), 500, "Verification could not be resent."],
  ])("maps resend failure %s safely", async (error, status, message) => {
    const route = createAdminNotificationRecipientVerificationRoute(dependencies({
      resendVerification: vi.fn().mockRejectedValue(error),
    }));

    const response = await route.POST(request({ idempotencyKey: "recipient-resend-2" }), context);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
