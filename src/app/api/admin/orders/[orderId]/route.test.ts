import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminOrderRoute } from "./route-handler";

const origin = "http://localhost:3000";
const orderId = "63f77c27-fd7b-4c65-a834-886c128b6cc1";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin order mutation route", () => {
  it("returns 401 and 403 before invoking order mutations", async () => {
    for (const status of [401, 403]) {
      const mutations = {
        changeStatus: vi.fn(),
        addNote: vi.fn(),
        setTracking: vi.fn(),
      };
      const route = createAdminOrderRoute({
        requirePermission: vi.fn().mockRejectedValue(new HttpError("Denied", status)),
        mutations,
        trustedOrigin: origin,
      });
      const response = await route.PATCH(
        request({ action: "add_note" }),
        { params: Promise.resolve({ orderId }) },
      );
      expect(response.status).toBe(status);
      expect(mutations.addNote).not.toHaveBeenCalled();
    }
  });

  it("rejects cross-origin requests", async () => {
    const mutations = {
      changeStatus: vi.fn(),
      addNote: vi.fn(),
      setTracking: vi.fn(),
    };
    const route = createAdminOrderRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
      mutations,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ action: "add_note" }, "https://attacker.example"),
      { params: Promise.resolve({ orderId }) },
    );
    expect(response.status).toBe(403);
    expect(mutations.addNote).not.toHaveBeenCalled();
  });

  it("dispatches a validated status update with the authenticated actor", async () => {
    const changeStatus = vi.fn().mockResolvedValue("updated");
    const route = createAdminOrderRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
      mutations: { changeStatus, addNote: vi.fn(), setTracking: vi.fn() },
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({
        action: "change_status",
        toStatus: "designing",
        reason: "Assigned",
        idempotencyKey: "status-change-0001",
      }),
      { params: Promise.resolve({ orderId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "updated" });
    expect(changeStatus).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      expect.objectContaining({
        orderId,
        toStatus: "designing",
        idempotencyKey: "status-change-0001",
      }),
    );
  });

  it("returns 422 for an unknown action", async () => {
    const route = createAdminOrderRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
      mutations: { changeStatus: vi.fn(), addNote: vi.fn(), setTracking: vi.fn() },
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ action: "change_price", total: 1 }),
      { params: Promise.resolve({ orderId }) },
    );
    expect(response.status).toBe(422);
  });
});
