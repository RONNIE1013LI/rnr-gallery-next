// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAdminFlikFeatureRoute } from "./route-handler";
import { HttpError } from "@/server/auth/require-session";
import type { FlikFeatureSnapshot } from "@/server/payments/flik-feature";
import { FlikFeatureConflictError } from "@/server/payments/flik-feature-repository";
const origin = "https://rnrgallery.com";
const snapshot: FlikFeatureSnapshot = { status: "disabled", ready: false, canManage: true, readiness: [{ code: "migration", label: "Required database migration", ready: false }] };
const change = { status: "internal_verification", expectedStatus: "disabled", idempotencyKey: "10000000-0000-4000-8000-000000000001" };
function setup() {
  const service = { getSnapshot: vi.fn(async () => snapshot), readySnapshot: vi.fn(async () => snapshot), transition: vi.fn(async () => snapshot) };
  const acquire = vi.fn(async () => service);
  const requirePermission = vi.fn(async () => ({ user: { id: "owner", email: "owner@example.test" }, adminRole: "admin" as "admin" | "staff" }));
  return { service, acquire, requirePermission, route: createAdminFlikFeatureRoute({ requirePermission, service: acquire, trustedOrigin: origin }) };
}
function request(body: unknown = change, requestOrigin = origin) { return new Request(`${origin}/api/admin/payments/flik-feature`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
describe("admin Flik feature availability", () => {
  it("returns readiness and owner-management capability without caching", async () => {
    const { route, requirePermission, service } = setup();
    const response = await route.GET();
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_payment");
    expect(service.getSnapshot).toHaveBeenCalledWith(true);
  });
  it("allows payment-managing staff to read but never change", async () => {
    const { route, requirePermission, service } = setup();
    requirePermission.mockResolvedValue({ user: { id: "staff", email: "staff@example.test" }, adminRole: "staff" });
    expect((await route.GET()).status).toBe(200);
    expect(service.getSnapshot).toHaveBeenCalledWith(false);
    expect((await route.POST(request())).status).toBe(403);
    expect(service.transition).not.toHaveBeenCalled();
  });
  it("uses only the authenticated owner's audit identity", async () => {
    const { route, service } = setup();
    expect((await route.POST(request())).status).toBe(200);
    expect(service.transition).toHaveBeenCalledWith(change, { userId: "owner", email: "owner@example.test", role: "admin" });
  });
  it("passes explicit live verification confirmation to the owner transition service", async () => {
    const { route, service } = setup();
    const live = { ...change, status: "live", expectedStatus: "internal_verification", liveVerificationConfirmed: true };
    expect((await route.POST(request(live))).status).toBe(200);
    expect(service.transition).toHaveBeenCalledWith(live, expect.objectContaining({ role: "admin" }));
  });
  it.each([401, 403])("rejects unauthorized callers before state reads or writes %s", async (status) => {
    const { route, requirePermission, acquire } = setup();
    requirePermission.mockRejectedValue(new HttpError("Forbidden", status));
    expect((await route.GET()).status).toBe(status);
    expect((await route.POST(request())).status).toBe(status);
    expect(acquire).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations before acquiring storage", async () => {
    const { route, acquire } = setup();
    expect((await route.POST(request(change, "https://evil.example"))).status).toBe(403);
    expect(acquire).not.toHaveBeenCalled();
  });
  it.each([{ ready: true }, { actor: { userId: "owner" } }, { migrationReady: true }, { secret: "credential" }])("rejects client readiness and identity claims %o", async (extra) => {
    const { route, acquire } = setup();
    expect((await route.POST(request({ ...change, ...extra }))).status).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
  });
  it("reports stale settings as a conflict without exposing internal details", async () => {
    const { route, service } = setup();
    service.transition.mockRejectedValue(new FlikFeatureConflictError());
    expect((await route.POST(request())).status).toBe(409);
  });
  it("hides storage errors and refuses to claim enabling succeeded", async () => {
    const { route, acquire } = setup();
    acquire.mockRejectedValue(new Error("database secret connection"));
    const response = await route.POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database secret");
  });
});
