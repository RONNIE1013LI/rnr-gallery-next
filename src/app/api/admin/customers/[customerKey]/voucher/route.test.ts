import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { verifyReturningCustomerVoucher } from "@/server/checkout/returning-customer-voucher";
import { createAdminCustomerVoucherRoute } from "./route-handler";
const origin = "http://localhost:3000";
const secret = "test-only-returning-voucher-secret-123456789";
const context = { params: Promise.resolve({ customerKey: "customer-1" }) };
function request(body: unknown = { previousOrderNumber: "01234", verified: true }, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/customers/customer-1/voucher`, { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body) });
}
function setup() {
  const deps = { requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test" } }), detail: vi.fn().mockResolvedValue({ account: { id: "customer-1" }, orders: [] }), audit: vi.fn().mockResolvedValue(undefined), canIssue: vi.fn().mockResolvedValue(true), secret: () => secret, enabled: true, trustedOrigin: origin };
  return { deps, route: createAdminCustomerVoucherRoute(deps) };
}
describe("admin returning voucher issuance", () => {
  it("requires both permissions before lookup or audit", async () => {
    for (const status of [401, 403]) {
      const { deps, route } = setup();
      deps.requirePermission.mockRejectedValue(new HttpError("Denied", status));
      expect((await route.POST(request(), context)).status).toBe(status);
      expect(deps.detail).not.toHaveBeenCalled();
      expect(deps.audit).not.toHaveBeenCalled();
    }
    const { deps, route } = setup();
    deps.requirePermission.mockImplementation(async (permission) => { if (permission === "manage_prices") throw new HttpError("Denied", 403); return { user: { id: "admin-1" } }; });
    expect((await route.POST(request(), context)).status).toBe(403);
    expect(deps.detail).not.toHaveBeenCalled();
  });
  it("rejects untrusted origin and invalid manual verification", async () => {
    const { deps, route } = setup();
    expect((await route.POST(request(undefined, "https://attacker.test"), context)).status).toBe(403);
    for (const body of [null, {}, { previousOrderNumber: "1234", verified: true }, { previousOrderNumber: "123456", verified: true }, { previousOrderNumber: "12345", verified: false }, { previousOrderNumber: "12345", verified: "true" }]) {
      expect((await route.POST(request(body), context)).status).toBe(422);
    }
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it("does not issue to guests or missing customers or during campaign closure", async () => {
    const { deps, route } = setup();
    deps.detail.mockResolvedValueOnce(null).mockResolvedValueOnce({ account: null });
    expect((await route.POST(request(), context)).status).toBe(404);
    expect((await route.POST(request(), context)).status).toBe(422);
    const disabled = createAdminCustomerVoucherRoute({ ...deps, enabled: false });
    expect((await disabled.POST(request(), context)).status).toBe(409);
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it("issues for verified offline history and audits without exposing code or secret", async () => {
    const { deps, route } = setup();
    const response = await route.POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { code } = await response.json();
    expect(verifyReturningCustomerVoucher(code, "customer-1", secret)).toBe(true);
    expect(deps.requirePermission.mock.calls.map(([permission]) => permission)).toEqual(["view_customers", "manage_prices"]);
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "admin-1", resourceId: "customer-1", afterSummary: expect.objectContaining({ previousOrderNumber: "01234", verified: true }) }));
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(code);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(secret);
  });
  it("withholds the code if the audit cannot be recorded", async () => {
    const { deps, route } = setup();
    deps.audit.mockRejectedValue(new Error("private database error"));
    const response = await route.POST(request(), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database error");
  });
  it("rejects used or reserved offers before accessing the signing secret or audit", async () => {
    const { deps } = setup();
    deps.canIssue.mockResolvedValue(false);
    const secret = vi.fn(() => "unused-signing-secret");
    const response = await createAdminCustomerVoucherRoute({ ...deps, secret }).POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "An offer is already reserved or this returning-customer voucher has been used. Resume the existing order or review the customer account." });
    expect(deps.canIssue).toHaveBeenCalledWith("customer-1");
    expect(secret).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

});
