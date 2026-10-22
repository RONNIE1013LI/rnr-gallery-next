import { describe, expect, it, vi } from "vitest";
import { createWisePayIdProvider } from "./wise-payid-provider";
const id = "12345678-1234-4234-8234-123456789abc";
const order = { id, orderNumber: "pending-fixture", amountCents: 12340, currency: "AUD", market: "AU", customer: { fullName: "Fixture", email: "fixture@example.test", phone: "" }, billingAddress: { country: "AU" }, deliveryAddress: { country: "AU" } };
describe("PayID provider", () => {
  it("returns immutable bank instructions and never calls Wise to start payment", async () => {
    const createIntent = vi.fn(async () => ({ id, reference: "RRA1234567812344234", amountCents: 12340, currency: "AUD" }));
    const provider = createWisePayIdProvider({ config: { profileId: 1, balanceId: 2, token: "fixture", autoMatch: false }, repository: { createIntent } });
    const result = await provider.createOrReuse({ attemptId: id, order, returnUrl: "https://fixture.test", returnState: "", cancelUrl: "", idempotencyKey: id } as never);
    expect(result).toMatchObject({ kind: "bank_transfer", provider: "wise", method: "payid", payId: "payment@rnrgallery.com", amountCents: 12340, currency: "AUD", reference: "RRA1234567812344234" });
    expect(createIntent).toHaveBeenCalledOnce();
  });
  it("cannot confirm payment through a browser return or generic polling", async () => {
    const provider = createWisePayIdProvider({ config: { profileId: 1, balanceId: 2, token: "fixture", autoMatch: false } });
    await expect(provider.completeReturn({} as never)).rejects.toThrow();
    await expect(provider.retrieve!({} as never)).rejects.toThrow();
  });
});
