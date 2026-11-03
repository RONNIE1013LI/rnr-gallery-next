import { describe, expect, it, vi } from "vitest";
import { createAdminCustomerVoucherRoute } from "@/app/api/admin/customers/[customerKey]/voucher/route-handler";
import { HttpError } from "@/server/auth/require-session";
import { verifyReturningCustomerVoucher } from "@/server/checkout/returning-customer-voucher";
import { createFormsJobVoucherRoute } from "./route-handler";
import * as publicRoute from "./route";

const origin = "https://shop.example.test";
const version = "2026-11-02T12:00:00.000Z";
const context = { params: Promise.resolve({ jobId: "job-1" }) };
const access = { user: { id: "admin-1", email: "admin@example.test" }, formRole: "admin" as const, formProfile: null };
const secret = "test-only-returning-voucher-secret-123456789";
function request(body: unknown = { previousOrderNumber: "08087", expectedUpdatedAt: version, verified: true }, requestOrigin = origin) {
  return new Request(`${origin}/api/forms/jobs/job-1/voucher`, { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body) });
}
function setup() {
  const adminDeps = {
    requirePermission: vi.fn().mockResolvedValue(access),
    detail: vi.fn().mockResolvedValue({ account: { id: "customer-1" } }),
    audit: vi.fn().mockResolvedValue(undefined), canIssue: vi.fn().mockResolvedValue(true),
    secret: () => secret, enabled: true, trustedOrigin: origin,
  };
  const deps = {
    requirePermission: vi.fn().mockResolvedValue(access),
    requireAdminPermission: vi.fn().mockResolvedValue(access),
    detail: vi.fn().mockResolvedValue({ job: { source: "manual", jobNumber: "08087", customerName: "Test customer", customerEmail: "customer@example.test", assignedUserId: null, updatedAt: new Date(version) } }),
    accountForEmail: vi.fn().mockResolvedValue("customer-1"),
    canIssue: vi.fn().mockResolvedValue(true),
    issue: vi.fn(createAdminCustomerVoucherRoute(adminDeps).POST),
    enabled: true, trustedOrigin: origin,
  };
  return { deps, adminDeps, route: createFormsJobVoucherRoute(deps) };
}

describe("saved Forms order voucher", () => {
  it("exports both handlers and loads saved context without issuing a voucher", async () => {
    expect(publicRoute.GET).toBeTypeOf("function");
    expect(publicRoute.POST).toBeTypeOf("function");
    const { deps, route } = setup();
    const response = await route.GET(new Request(origin), context);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ jobId: "job-1", orderNumber: "08087", customerName: "Test customer", customerEmail: "customer@example.test", customerKey: "customer-1", expectedUpdatedAt: version, canIssue: true });
    expect(deps.requirePermission.mock.calls.map(([p]) => p)).toEqual(["view_jobs", "view_customer_contact"]);
    expect(deps.requireAdminPermission.mock.calls.map(([p]) => p)).toEqual(["view_customers", "manage_prices"]);
    expect(deps.accountForEmail).toHaveBeenCalledWith("customer@example.test");
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it("requires job, contact and both existing issuance permissions before looking up a customer", async () => {
    for (const permission of ["view_jobs", "view_customer_contact", "view_customers", "manage_prices"]) {
      const { deps, route } = setup();
      const deny = async (p: string) => { if (p === permission) throw new HttpError("Denied", 403); return access; };
      deps.requirePermission.mockImplementation(deny);
      deps.requireAdminPermission.mockImplementation(deny);
      expect((await route.GET(new Request(origin), context)).status).toBe(403);
      expect((await route.POST(request(), context)).status).toBe(403);
      expect(deps.detail).not.toHaveBeenCalled();
      expect(deps.accountForEmail).not.toHaveBeenCalled();
      expect(deps.issue).not.toHaveBeenCalled();
    }
  });
  it("enforces assigned-only scope and rejects invalid references", async () => {
    const { deps, route } = setup();
    deps.requirePermission.mockResolvedValue({ ...access, formRole: "staff", formProfile: { adminPermissions: ["view_customers", "manage_prices"], formPermissions: ["view_jobs", "view_customer_contact"], assignedOnly: true } } as never);
    expect((await route.GET(new Request(origin), context)).status).toBe(404);
    deps.requirePermission.mockResolvedValue(access);
    for (const patch of [{ jobNumber: "invalid" }]) {
      const saved = await deps.detail("job-1");
      deps.detail.mockResolvedValueOnce({ job: { ...saved.job, ...patch } });
      expect((await route.POST(request(), context)).status).toBe(422);
    }
    deps.detail.mockResolvedValue(null);
    expect((await route.GET(new Request(origin), context)).status).toBe(404);
    expect(deps.accountForEmail).not.toHaveBeenCalled();
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it("explains missing accounts and used offers without issuing", async () => {
    const { deps, route } = setup();
    deps.accountForEmail.mockResolvedValue(null);
    expect(await (await route.GET(new Request(origin), context)).json()).toMatchObject({ canIssue: false, customerKey: null, message: expect.stringContaining("register") });
    expect((await route.POST(request(), context)).status).toBe(422);
    deps.accountForEmail.mockResolvedValue("customer-1");
    deps.canIssue.mockResolvedValue(false);
    expect(await (await route.GET(new Request(origin), context)).json()).toMatchObject({ canIssue: false, message: expect.stringContaining("reserved") });
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it("rejects untrusted, invalid, stale and mismatched requests before issuing", async () => {
    const { deps, route } = setup();
    expect((await route.POST(request(undefined, "https://attacker.test"), context)).status).toBe(403);
    for (const body of [null, {}, { previousOrderNumber: "08087", expectedUpdatedAt: version, verified: false }, { previousOrderNumber: "08087", expectedUpdatedAt: version, verified: true, customerKey: "other" }]) {
      expect((await route.POST(request(body), context)).status).toBe(422);
    }
    for (const body of [{ previousOrderNumber: "12345", expectedUpdatedAt: version, verified: true }, { previousOrderNumber: "08087", expectedUpdatedAt: "2026-11-01T12:00:00.000Z", verified: true }]) {
      expect((await route.POST(request(body), context)).status).toBe(409);
    }
    expect((await route.POST(request({ previousOrderNumber: "08087", expectedUpdatedAt: version, verified: true, oversized: "x".repeat(2000) }), context)).status).toBe(413);
    expect(deps.accountForEmail).not.toHaveBeenCalled();
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it("delegates to existing audited account-bound issuance with saved account and reference", async () => {
    const { deps, adminDeps, route } = setup();
    const response = await route.POST(request(), context);
    expect(response.status).toBe(200);
    const { code } = await response.json();
    expect(verifyReturningCustomerVoucher(code, "customer-1", secret)).toBe(true);
    expect(deps.issue).toHaveBeenCalledOnce();
    expect(await deps.issue.mock.calls[0][1].params).toEqual({ customerKey: "customer-1" });
    expect(adminDeps.audit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "customer-1", afterSummary: expect.objectContaining({ previousOrderNumber: "08087", verified: true }) }));
    expect(JSON.stringify(adminDeps.audit.mock.calls)).not.toContain(code);
  });
  it.each(["08088", "RNR-2026-ABC123"])("loads and issues from an automatic web order %s", async (orderNumber) => {
    const { deps, adminDeps, route } = setup();
    const saved = await deps.detail("job-1");
    deps.detail.mockResolvedValue({ job: { ...saved.job, source: "web", jobNumber: orderNumber } });
    expect(await (await route.GET(new Request(origin), context)).json()).toMatchObject({ orderNumber, canIssue: true });
    const response = await route.POST(request({ previousOrderNumber: orderNumber, expectedUpdatedAt: version, verified: true }), context);
    expect(response.status).toBe(200);
    const { code } = await response.json();
    expect(verifyReturningCustomerVoucher(code, "customer-1", secret)).toBe(true);
    expect(adminDeps.audit).toHaveBeenCalledWith(expect.objectContaining({ afterSummary: expect.objectContaining({ previousOrderNumber: orderNumber }) }));
  });
  it("retains existing used-offer and audit-failure checks on POST", async () => {
    const { adminDeps, route } = setup();
    adminDeps.canIssue.mockResolvedValue(false);
    expect((await route.POST(request(), context)).status).toBe(409);
    expect(adminDeps.audit).not.toHaveBeenCalled();
    adminDeps.canIssue.mockResolvedValue(true);
    adminDeps.audit.mockRejectedValue(new Error("private failure"));
    const response = await route.POST(request(), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private failure");
  });
  it("fails closed when the campaign is disabled or lookup fails", async () => {
    const { deps } = setup();
    expect((await createFormsJobVoucherRoute({ ...deps, enabled: false }).GET(new Request(origin), context)).status).toBe(409);
    deps.accountForEmail.mockRejectedValue(new Error("private lookup failure"));
    const response = await createFormsJobVoucherRoute(deps).GET(new Request(origin), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private lookup failure");
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it("reads campaign state for each GET and POST without looking up jobs when disabled", async () => {
    const { deps } = setup();
    let available = true;
    const enabled = vi.fn(async () => available);
    const route = createFormsJobVoucherRoute({ ...deps, enabled });
    expect((await route.GET(new Request(origin), context)).status).toBe(200);
    available = false;
    deps.detail.mockClear();
    deps.accountForEmail.mockClear();
    for (const response of [await route.GET(new Request(origin), context), await route.POST(request(), context)]) {
      expect(response.status).toBe(409);
      expect(await response.json()).not.toHaveProperty("code");
    }
    expect(deps.detail).not.toHaveBeenCalled();
    expect(deps.accountForEmail).not.toHaveBeenCalled();
    expect(deps.issue).not.toHaveBeenCalled();
    available = true;
    expect((await route.POST(request(), context)).status).toBe(200);
    expect(enabled).toHaveBeenCalledTimes(4);
  });
  it("fails closed for campaign read errors on GET and POST", async () => {
    const { deps } = setup();
    const route = createFormsJobVoucherRoute({ ...deps, enabled: vi.fn().mockRejectedValue(new Error("private state failure")) });
    for (const response of [await route.GET(new Request(origin), context), await route.POST(request(), context)]) {
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private state failure");
    }
    expect(deps.detail).not.toHaveBeenCalled();
    expect(deps.accountForEmail).not.toHaveBeenCalled();
    expect(deps.issue).not.toHaveBeenCalled();
  });
});
