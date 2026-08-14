import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminProductionFieldsRoute } from "./route-handler";

const origin = "http://localhost:3000";
const access = { user: { id: "admin-1", email: "owner@example.test" }, adminRole: "admin" as const };

function request(method: "POST" | "PATCH", body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/jobs/fields`, {
    method,
    headers: { "Content-Type": "application/json", Origin: requestOrigin, "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site" },
    body: JSON.stringify(body),
  });
}

describe("admin production fields route", () => {
  it("keeps field configuration admin-only", async () => {
    const list = vi.fn();
    const route = createAdminProductionFieldsRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list,
      create: vi.fn(),
      update: vi.fn(),
      trustedOrigin: origin,
    });
    expect((await route.GET()).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("lists, creates and updates audited definitions", async () => {
    const list = vi.fn().mockResolvedValue([{ fieldKey: "eteams_status" }]);
    const create = vi.fn().mockResolvedValue({ id: "field-1", fieldKey: "venue" });
    const update = vi.fn().mockResolvedValue("updated");
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createAdminProductionFieldsRoute({ requirePermission, list, create, update, trustedOrigin: origin });
    expect((await route.GET()).status).toBe(200);
    const createBody = { idempotencyKey: "field-create-0001", fieldKey: "venue" };
    expect((await route.POST(request("POST", createBody))).status).toBe(201);
    expect(create).toHaveBeenCalledWith({ userId: "admin-1", email: "owner@example.test" }, createBody);
    const updateBody = { idempotencyKey: "field-update-0001", fieldId: "field-1" };
    expect((await route.PATCH(request("PATCH", updateBody))).status).toBe(200);
    expect(update).toHaveBeenCalledWith({ userId: "admin-1", email: "owner@example.test" }, updateBody);
    expect(requirePermission).toHaveBeenCalledWith("manage_production_fields");
  });

  it("rejects cross-origin mutations", async () => {
    const create = vi.fn();
    const route = createAdminProductionFieldsRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      list: vi.fn(),
      create,
      update: vi.fn(),
      trustedOrigin: origin,
    });
    expect((await route.POST(request("POST", {}, "https://evil.example"))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
