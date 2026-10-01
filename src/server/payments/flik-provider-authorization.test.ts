import { describe, expect, it, vi } from "vitest";
import { createFlikProvider } from "./flik-provider";
import type { EnabledFlikConfig } from "./flik-config";
import type { PaymentOrder } from "./types";
import type { FlikRepository } from "./flik-repository";
import { createFlikSessionService } from "./flik-session-service";
import { parsePaymentConfig } from "./config";
import { selectPaymentProviders } from "./provider-registry";

const config: EnabledFlikConfig = { enabled: true, mode: "live", testMode: false, deployment: "production", clientId: "flik_live_cid_fixture", clientSecret: "flik_live_sk_fixture", webhookSecret: "whsec_fixture" };
const order = { id: "10000000-0000-4000-8000-000000000001", orderNumber: "PAY-FIXTURE", market: "NZ", currency: "NZD", amountCents: 100,
  customer: { fullName: "Fixture", email: "fixture@example.test", phone: "" }, billingAddress: { country: "NZ" }, deliveryAddress: { country: "NZ" } } as PaymentOrder;
describe("Flik provider server feature gate", () => {
  it("never registers Flik from environment credentials alone", () => {
    expect(selectPaymentProviders({ ...parsePaymentConfig({}), flik: config }).some(({ method }) => method === "flik")).toBe(false);
  });
  it("rejects direct provider construction without readiness/audience authorization", async () => {
    const provider = createFlikProvider({ config });
    expect(await provider.availability(order)).toMatchObject({ available: false });
    await expect(provider.retrieve({ order, providerReference: "cs_fixture" })).rejects.toThrow();
  });
  it("rechecks a previous allowed option before calling the session service", async () => {
    const canCreate = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const start = vi.fn();
    const provider = createFlikProvider({ config, authorization: { canCreate, canReconcile: vi.fn() }, sessionService: { start } as unknown as ReturnType<typeof createFlikSessionService> });
    expect(await provider.availability(order)).toMatchObject({ available: true });
    await expect(provider.createOrReuse({ order, attemptId: order.id, idempotencyKey: order.id, returnState: "a".repeat(64), returnUrl: "https://rnrgallery.com/api/payments/returns/flik", cancelUrl: "https://rnrgallery.com/checkout" })).rejects.toThrow();
    expect(canCreate).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });
  it("rejects AU even if feature authorization would approve it", async () => {
    const canCreate = vi.fn().mockResolvedValue(true);
    const provider = createFlikProvider({ config, authorization: { canCreate, canReconcile: vi.fn() } });
    expect(await provider.availability({ ...order, market: "AU" })).toMatchObject({ available: false });
    expect(canCreate).not.toHaveBeenCalled();
  });
  it("checks migrated readiness before querying saved sessions on a return", async () => {
    const findSessionByProviderReference = vi.fn();
    const provider = createFlikProvider({ config, authorization: { canCreate: vi.fn(), canReconcile: vi.fn().mockResolvedValue(false) }, repository: { findSessionByProviderReference } as unknown as FlikRepository });
    await expect(provider.retrieve({ order, providerReference: "cs_fixture" })).rejects.toThrow();
    expect(findSessionByProviderReference).not.toHaveBeenCalled();
  });
});
