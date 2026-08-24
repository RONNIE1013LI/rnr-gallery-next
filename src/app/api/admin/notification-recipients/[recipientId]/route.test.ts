import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import {
  InternalNotificationRecipientConflictError,
  InternalNotificationRecipientNotFoundError,
  InternalNotificationRecipientValidationError,
  type InternalNotificationRecipientView,
} from "@/server/notifications/internal-notification-recipient-service";
import { createAdminNotificationRecipientRoute } from "./route-handler";

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
    status: "active",
    topics: ["manual_order_created"],
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    verifiedAt: new Date("2026-08-24T01:00:00.000Z"),
    verificationExpiresAt: null,
    disabledAt: null,
  };
}

function request(method: "PATCH" | "DELETE", body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/notification-recipients/${recipientId}`, {
    method,
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
    updateSubscriptions: vi.fn().mockResolvedValue(recipient()),
    disable: vi.fn().mockResolvedValue({ ...recipient(), status: "disabled" }),
    trustedOrigin: origin,
    ...overrides,
  };
}

describe("Admin notification recipient item route", () => {
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

    const response = await createAdminNotificationRecipientRoute().PATCH(
      request("PATCH", {
        topics: ["manual_order_created"],
        idempotencyKey: "recipient-update-runtime-failure",
      }),
      context,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "The notification recipient could not be updated.",
    });
  });

  it("replaces subscriptions using the path identity and real Admin actor", async () => {
    const updateSubscriptions = vi.fn().mockResolvedValue(recipient());
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    const route = createAdminNotificationRecipientRoute(dependencies({
      updateSubscriptions,
      requirePermission,
    }));

    const response = await route.PATCH(request("PATCH", {
      recipientId: "20000000-0000-4000-8000-000000000002",
      topics: ["website_ai_human_review_required"],
      idempotencyKey: "recipient-update-1",
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(updateSubscriptions).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      {
        recipientId,
        topics: ["website_ai_human_review_required"],
        idempotencyKey: "recipient-update-1",
      },
    );
    const body = await response.json();
    expect(body).toEqual({ recipient: expect.objectContaining({ id: recipientId }) });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("soft-disables through JSON with exact role-management authorization", async () => {
    const disable = vi.fn().mockResolvedValue({ ...recipient(), status: "disabled" });
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    const route = createAdminNotificationRecipientRoute(dependencies({ disable, requirePermission }));

    const response = await route.DELETE(request("DELETE", {
      idempotencyKey: "recipient-disable-1",
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(disable).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      { recipientId, idempotencyKey: "recipient-disable-1" },
    );
    expect(JSON.stringify(await response.json())).not.toContain("token");
  });

  it("rejects Staff, cross-origin, malformed, and oversized mutations before services", async () => {
    const updateSubscriptions = vi.fn();
    const disable = vi.fn();
    const denied = createAdminNotificationRecipientRoute(dependencies({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      updateSubscriptions,
      disable,
    }));
    const route = createAdminNotificationRecipientRoute(dependencies({ updateSubscriptions, disable }));

    expect((await denied.PATCH(request("PATCH", {}), context)).status).toBe(403);
    expect((await denied.DELETE(request("DELETE", {}), context)).status).toBe(403);
    expect((await route.PATCH(request("PATCH", {}, "https://attacker.example"), context)).status).toBe(403);
    expect((await route.PATCH(new Request(`${origin}/api/admin/notification-recipients/${recipientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
      body: "{",
    }), context)).status).toBe(400);
    expect((await route.DELETE(request("DELETE", { idempotencyKey: "x".repeat(17_000) }), context)).status).toBe(413);
    expect(updateSubscriptions).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it.each([
    [new InternalNotificationRecipientValidationError("private validation"), 422, "Invalid notification recipient input"],
    [new InternalNotificationRecipientNotFoundError("private missing"), 404, "Notification recipient not found"],
    [new InternalNotificationRecipientConflictError("private stale state"), 409, "The notification recipient changed. Refresh and try again."],
    [new Error("database secret"), 500, "The notification recipient could not be updated."],
  ])("maps item failure %s safely", async (error, status, message) => {
    const route = createAdminNotificationRecipientRoute(dependencies({
      updateSubscriptions: vi.fn().mockRejectedValue(error),
    }));

    const response = await route.PATCH(request("PATCH", {
      topics: ["manual_order_created"],
      idempotencyKey: "recipient-update-2",
    }), context);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the same safe error mapping for disable failures", async () => {
    const route = createAdminNotificationRecipientRoute(dependencies({
      disable: vi.fn().mockRejectedValue(new InternalNotificationRecipientNotFoundError()),
    }));

    const response = await route.DELETE(request("DELETE", {
      idempotencyKey: "recipient-disable-2",
    }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Notification recipient not found" });
  });
});
