import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import {
  InternalNotificationRecipientConflictError,
  InternalNotificationRecipientValidationError,
  type InternalNotificationRecipientView,
} from "@/server/notifications/internal-notification-recipient-service";
import { createAdminNotificationRecipientsRoute } from "./route-handler";

const origin = "http://localhost:3000";

function recipient(
  overrides: Partial<InternalNotificationRecipientView> = {},
): InternalNotificationRecipientView {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "ops@example.test",
    status: "active",
    topics: ["web_order_paid"],
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    verifiedAt: new Date("2026-08-24T01:00:00.000Z"),
    verificationExpiresAt: null,
    disabledAt: null,
    ...overrides,
  };
}

function mutationRequest(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/notification-recipients`, {
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
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({
      recipient: recipient({ status: "pending_verification", verifiedAt: null }),
      verificationDelivery: "sent",
    }),
    trustedOrigin: origin,
    ...overrides,
  };
}

describe("Admin notification recipient collection route", () => {
  it("lists only Admin-safe recipients with active coverage and no-store", async () => {
    const list = vi.fn().mockResolvedValue([
      recipient(),
      recipient({
        id: "10000000-0000-4000-8000-000000000002",
        email: "pending@example.test",
        status: "pending_verification",
        topics: ["manual_order_created", "web_order_paid"],
        verifiedAt: null,
        verificationExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ]);
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    const route = createAdminNotificationRecipientsRoute(
      dependencies({ list, requirePermission }),
    );

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    const body = await response.json();
    expect(body).toEqual({
      recipients: expect.arrayContaining([
        expect.objectContaining({ email: "ops@example.test" }),
        expect.objectContaining({ email: "pending@example.test" }),
      ]),
      coverage: {
        manual_order_created: 0,
        web_order_paid: 1,
        payment_request_paid: 0,
        proof_approved: 0,
        proof_changes_requested: 0,
      },
    });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("denies Staff list access without discovering recipient data", async () => {
    const list = vi.fn();
    const route = createAdminNotificationRecipientsRoute(dependencies({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list,
    }));

    const response = await route.GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(list).not.toHaveBeenCalled();
  });

  it("creates a pending recipient with the real Admin actor and delivery outcome", async () => {
    const add = vi.fn().mockResolvedValue({
      recipient: recipient({ status: "pending_verification", verifiedAt: null }),
      verificationDelivery: "failed",
    });
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    const route = createAdminNotificationRecipientsRoute(
      dependencies({ add, requirePermission }),
    );
    const input = {
      email: " Ops@Example.Test ",
      topics: ["web_order_paid"],
      idempotencyKey: "recipient-create-1",
    };

    const response = await route.POST(mutationRequest(input));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(add).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      input,
    );
    const body = await response.json();
    expect(body).toEqual({
      recipient: expect.objectContaining({ email: "ops@example.test" }),
      verificationDelivery: "failed",
    });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("rejects Staff, cross-origin, non-JSON, and oversized create requests before add", async () => {
    const add = vi.fn();
    const denied = createAdminNotificationRecipientsRoute(dependencies({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      add,
    }));
    const route = createAdminNotificationRecipientsRoute(dependencies({ add }));

    expect((await denied.POST(mutationRequest({}))).status).toBe(401);
    expect((await route.POST(mutationRequest({}, "https://attacker.example"))).status).toBe(403);
    expect((await route.POST(new Request(`${origin}/api/admin/notification-recipients`, {
      method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
      body: "not-json",
    }))).status).toBe(415);
    expect((await route.POST(mutationRequest({ email: "x".repeat(17_000) }))).status).toBe(413);
    expect(add).not.toHaveBeenCalled();
  });

  it.each([
    [new InternalNotificationRecipientValidationError("private validation detail"), 422, "Invalid notification recipient input"],
    [new InternalNotificationRecipientConflictError("private conflict detail"), 409, "Notification recipient already exists"],
    [new Error("database secret"), 500, "The notification recipient could not be saved."],
  ])("maps create failure %s to a bounded safe response", async (error, status, message) => {
    const route = createAdminNotificationRecipientsRoute(dependencies({
      add: vi.fn().mockRejectedValue(error),
    }));

    const response = await route.POST(mutationRequest({
      email: "ops@example.test",
      topics: ["web_order_paid"],
      idempotencyKey: "recipient-create-2",
    }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
