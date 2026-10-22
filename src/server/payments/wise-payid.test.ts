import { describe, expect, it, vi } from "vitest";
import { parseWisePayIdConfig, wisePayIdEligible } from "./wise-payid-config";
import { createWiseReadOnlyClient, WiseReadError } from "./wise-readonly-client";
import { parseWiseStatement, matchWiseCredit } from "./wise-payid-matching";

const env = { ENABLE_WISE_PAYID: "true", WISE_API_TOKEN: "fixture-token", WISE_BUSINESS_PROFILE_ID: "1", WISE_AUD_BALANCE_ID: "2" };
const now = new Date("2026-10-22T00:00:00Z");
const intent = { id: "attempt-1", reference: "RRA0123456789ABCDEF", amountCents: 12340, currency: "AUD", createdAt: new Date("2026-10-21T00:00:00Z"), status: "pending" };
function statement(change: Record<string, unknown> = {}) {
  return { query: { accountId: 2, currency: "AUD" }, transactions: [{ type: "CREDIT", date: now.toISOString(), amount: { value: 123.4, currency: "AUD" }, totalFees: { value: 0, currency: "AUD" }, referenceNumber: "TRANSFER-123", details: { type: "DEPOSIT", paymentReference: intent.reference, senderName: "Fixture payer" }, ...change }] };
}
const credit = () => parseWiseStatement(statement(), 2)[0];
describe("Wise PayID safety", () => {
  it("defaults off and keeps auto matching separately disabled", () => {
    expect(parseWisePayIdConfig({})).toBeNull();
    expect(parseWisePayIdConfig(env)?.autoMatch).toBe(false);
    expect(parseWisePayIdConfig({ ...env, WISE_PAYID_AUTOMATCH_VERIFIED: "true" })?.autoMatch).toBe(true);
    expect(parseWisePayIdConfig({ ...env, WISE_API_TOKEN: "" })).toBeNull();
  });
  it("only offers PayID for an AUD Australian order", () => {
    const context = { amountCents: 12340, currency: "AUD", market: "AU", billingAddress: { country: "AU" }, deliveryAddress: { country: "AU" } };
    expect(wisePayIdEligible(context)).toBe(true);
    for (const change of [{ market: "NZ" }, { currency: "NZD" }, { amountCents: 0 }, { billingAddress: null }, { deliveryAddress: { country: "NZ" } }]) expect(wisePayIdEligible({ ...context, ...change })).toBe(false);
  });
  it("reads exact minor units and uses paymentReference, never description as a reference", () => {
    expect(credit()).toMatchObject({ transactionId: "TRANSFER-123", amountCents: 12340, reference: intent.reference, payerName: "Fixture payer", eligible: true });
    expect(parseWiseStatement(statement({ details: { type: "DEPOSIT", description: intent.reference } }), 2)[0].reference).toBeNull();
    expect(parseWiseStatement(statement({ amount: { value: 123.401, currency: "AUD" } }), 2)[0].eligible).toBe(false);
  });
  it("rejects an unexpected statement account or currency", () => {
    expect(() => parseWiseStatement(statement(), 3)).toThrow();
    expect(() => parseWiseStatement({ ...statement(), query: { accountId: 2, currency: "NZD" } }, 2)).toThrow();
  });
  it("accepts the observed profile-bound response without accountId only with request identity", () => {
    const liveShape = { ...statement(), query: { profileId: 1, currency: "AUD" } };
    expect(parseWiseStatement(liveShape, 2, 1)).toHaveLength(1);
    expect(() => parseWiseStatement(liveShape, 2, 3)).toThrow();
    expect(() => parseWiseStatement(liveShape, 2)).toThrow();
  });
  it("requires one exact reference, amount and AUD credit after intent creation", () => {
    expect(matchWiseCredit(credit(), [intent])).toEqual({ kind: "matched", intentId: intent.id });
    for (const change of [{ reference: null }, { reference: intent.reference.toLowerCase() }, { amountCents: 12341 }, { currency: "NZD" }, { eligible: false }, { receivedAt: new Date("2026-10-20T00:00:00Z") }]) expect(matchWiseCredit({ ...credit(), ...change }, [intent]).kind).toBe("review");
    expect(matchWiseCredit(credit(), [intent, { ...intent, id: "another" }])).toEqual({ kind: "review", reason: "ambiguous_reference" });
    expect(matchWiseCredit(credit(), [{ ...intent, status: "paid" }]).kind).toBe("review");
  });
  it.each([
    { type: "DEBIT" },
    { details: { type: "CONVERSION", paymentReference: intent.reference } },
    { totalFees: { value: 1, currency: "AUD" } },
    { amount: { value: -123.4, currency: "AUD" } },
    { referenceNumber: "" },
  ])("never confirms an unsupported transaction %j", (change) => {
    expect(matchWiseCredit(parseWiseStatement(statement(change), 2)[0], [intent]).kind).toBe("review");
  });
  it("detects conflicting duplicate transaction IDs before matching", () => {
    const payload = statement();
    payload.transactions.push({ ...payload.transactions[0], amount: { value: 1, currency: "AUD" } });
    expect(() => parseWiseStatement(payload, 2)).toThrow();
  });
});
describe("Wise read-only client", () => {
  it("uses only official fixed-origin GET endpoints, no redirect or cache", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
    const client = createWiseReadOnlyClient("fixture-token", fetcher);
    await client.profiles(); await client.balances(1); await client.statement(1, 2, new Date("2026-10-21T00:00:00Z"), now); await client.subscriptions(1);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).origin)).toEqual(Array(4).fill("https://api.wise.com"));
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });
  it("never exposes a token or provider body in failures", async () => {
    const client = createWiseReadOnlyClient("fixture-token", vi.fn().mockResolvedValue(new Response("fixture-token private payer", { status: 403 })));
    await expect(client.profiles()).rejects.toEqual(new WiseReadError("http", 403));
  });
});
