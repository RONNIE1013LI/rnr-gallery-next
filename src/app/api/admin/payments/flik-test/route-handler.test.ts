// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAdminFlikTestRoute } from "./route-handler";
import { HttpError } from "@/server/auth/require-session";
const origin = "https://isolated.example.test";
const id = "10000000-0000-4000-8000-000000000001";
function setup() {
  const service = { start: vi.fn(async () => ({ id, status: "created" as const })), confirm: vi.fn(async () => ({ id, status: "completed" as const })) };
  const requirePermission = vi.fn(async () => ({ user: { id: "admin-1" } }));
  const getService = vi.fn(async () => service);
  const route = createAdminFlikTestRoute({ requirePermission, getService, trustedOrigin: origin });
  return { service, requirePermission, getService, route };
}
function request(body: unknown, requestOrigin = origin) { return new Request(`${origin}/api/admin/payments/flik-test`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
describe("admin isolated Flik test route", () => {
  it("requires manage_payment and binds the actor server-side", async () => {
    const { route, requirePermission, service } = setup();
    const response = await route.POST(request({ action: "create", idempotencyKey: id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_payment");
    expect(service.start).toHaveBeenCalledWith("admin-1", id);
  });
  it("confirms only the saved local session identifier", async () => {
    const { route, service } = setup();
    expect((await route.POST(request({ action: "confirm", sessionId: id }))).status).toBe(200);
    expect(service.confirm).toHaveBeenCalledWith("admin-1", id);
  });
  it.each([401, 403])("rejects unauthorized access before acquiring database runtime %s", async (status) => {
    const { route, requirePermission, getService } = setup();
    requirePermission.mockRejectedValueOnce(new HttpError("Forbidden", status));
    expect((await route.POST(request({ action: "create", idempotencyKey: id }))).status).toBe(status);
    expect(getService).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations before acquiring runtime", async () => {
    const { route, getService } = setup();
    expect((await route.POST(request({ action: "create", idempotencyKey: id }, "https://evil.example"))).status).toBe(403);
    expect(getService).not.toHaveBeenCalled();
  });
  it.each([{ amountCents: 1 }, { currency: "AUD" }, { adminUserId: "victim" }, { redirectUrl: "https://evil.example" }, { testMode: false }])("rejects client-controlled payment fields %o", async (extra) => {
    const { route, getService } = setup();
    expect((await route.POST(request({ action: "create", idempotencyKey: id, ...extra }))).status).toBe(400);
    expect(getService).not.toHaveBeenCalled();
  });
  it("reports unavailable config without starting any payment", async () => {
    const { service, requirePermission } = setup();
    const route = createAdminFlikTestRoute({ requirePermission, trustedOrigin: origin, getService: async () => null });
    expect((await route.POST(request({ action: "create", idempotencyKey: id }))).status).toBe(503);
    expect(service.start).not.toHaveBeenCalled();
  });
});
