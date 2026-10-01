import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), permission: vi.fn() }));
vi.mock("./flik-feature", () => ({ getFlikFeatureSnapshot: mocks.snapshot }));
vi.mock("@/server/auth/require-admin", () => ({ requireAdminPermission: mocks.permission }));
import { canCreateFlikCheckoutPayment, canReconcileFlikPayments } from "./flik-checkout-access";
import type { PaymentEligibilityContext } from "./types";
const context: PaymentEligibilityContext = { market: "NZ", currency: "NZD", amountCents: 100,
  customer: { fullName: "Fixture", email: "fixture@example.test", phone: "" },
  billingAddress: { country: "NZ" } as PaymentEligibilityContext["billingAddress"],
  deliveryAddress: { country: "NZ" } as PaymentEligibilityContext["deliveryAddress"] };
beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockResolvedValue({ status: "disabled", ready: true }); mocks.permission.mockResolvedValue({ user: { id: "admin" } }); });
describe("Flik runtime audience authorization", () => {
  it("keeps configured and migrated Disabled invisible and rejects creation", async () => {
    expect(await canCreateFlikCheckoutPayment(context)).toBe(false);
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each(["internal_verification", "live"])("rejects %s when readiness is incomplete", async (status) => {
    mocks.snapshot.mockResolvedValue({ status, ready: false });
    expect(await canCreateFlikCheckoutPayment(context)).toBe(false);
  });
  it("permits internal verification only for an authenticated payment administrator", async () => {
    mocks.snapshot.mockResolvedValue({ status: "internal_verification", ready: true });
    expect(await canCreateFlikCheckoutPayment(context)).toBe(true);
    expect(mocks.permission).toHaveBeenCalledWith("manage_payment");
    mocks.permission.mockRejectedValue(new Error("Forbidden"));
    expect(await canCreateFlikCheckoutPayment(context)).toBe(false);
  });
  it("enforces the internal amount ceiling on the server", async () => {
    mocks.snapshot.mockResolvedValue({ status: "internal_verification", ready: true });
    expect(await canCreateFlikCheckoutPayment({ ...context, amountCents: 10_001 })).toBe(false);
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it("allows eligible customers only after explicit Live state", async () => {
    mocks.snapshot.mockResolvedValue({ status: "live", ready: true });
    expect(await canCreateFlikCheckoutPayment(context)).toBe(true);
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each([{ market: "AU" }, { currency: "AUD" }, { market: undefined }, { billingAddress: null }, { deliveryAddress: { country: "AU" } }])("rejects an ineligible stored order before feature lookup %j", async (change) => {
    mocks.snapshot.mockResolvedValue({ status: "live", ready: true });
    expect(await canCreateFlikCheckoutPayment({ ...context, ...change } as PaymentEligibilityContext)).toBe(false);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("rechecks status for a stale page or provider instance", async () => {
    mocks.snapshot.mockResolvedValueOnce({ status: "live", ready: true }).mockResolvedValueOnce({ status: "disabled", ready: true });
    expect(await canCreateFlikCheckoutPayment(context)).toBe(true);
    expect(await canCreateFlikCheckoutPayment(context)).toBe(false);
  });
  it("fails closed on storage/readiness errors", async () => {
    mocks.snapshot.mockRejectedValue(new Error("unavailable"));
    expect(await canCreateFlikCheckoutPayment(context)).toBe(false);
    expect(await canReconcileFlikPayments()).toBe(false);
  });
  it("keeps in-flight confirmation available after disabling, only with ready schema/config", async () => {
    expect(await canReconcileFlikPayments()).toBe(true);
    mocks.snapshot.mockResolvedValue({ status: "disabled", ready: false });
    expect(await canReconcileFlikPayments()).toBe(false);
  });
});
