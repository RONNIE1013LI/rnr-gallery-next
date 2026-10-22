import { describe, expect, it, vi } from "vitest";
import { consumeWiseReceipt, type WiseTransaction } from "./wise-payid-repository";
const expected = { orderId: "order", reference: "RRA0123456789ABCDEF", merchantReference: "pending-order", amountCents: 12340 };
const intent = { id: "attempt", ...expected, profileId: 1, balanceId: 2 };
const receipt = { id: "receipt", intentId: "attempt", digest: "digest", eligible: true, status: "reserved", amountCents: 12340, currency: "AUD", profileId: 1, balanceId: 2 };
function transaction(changeReceipt = {}, changeIntent = {}) {
  const values = [[{ ...receipt, ...changeReceipt }], [{ ...intent, ...changeIntent }]];
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const insert = vi.fn(() => ({ values: async () => undefined }));
  const tx = { select: () => ({ from() { return this; }, where() { return this; }, for() { return this; }, limit: async () => values.shift() }), update, insert };
  return { tx: tx as unknown as WiseTransaction, update };
}
describe("Wise receipt proof before paid transition", () => {
  it("consumes a valid reserved receipt once and accepts its idempotent replay", async () => {
    const ctx = transaction();
    await consumeWiseReceipt(ctx.tx, "attempt", "receipt", "digest", expected);
    expect(ctx.update).toHaveBeenCalledOnce();
    const replay = transaction({ status: "applied" });
    await consumeWiseReceipt(replay.tx, "attempt", "receipt", "digest", expected);
    expect(replay.update).not.toHaveBeenCalled();
  });
  it.each([{ orderId: "another-order" }, { reference: "another-reference" }, { merchantReference: "another-order-reference" }, { amountCents: 12341 }])("rejects intent proof which differs from the locked order %j", async (change) => {
    const ctx = transaction({}, change);
    await expect(consumeWiseReceipt(ctx.tx, "attempt", "receipt", "digest", expected)).rejects.toThrow();
    expect(ctx.update).not.toHaveBeenCalled();
  });
  it.each([{ digest: "changed" }, { intentId: "another-attempt" }, { profileId: 3 }, { balanceId: 3 }, { amountCents: 12341 }, { currency: "NZD" }, { eligible: false }, { status: "review" }])("rejects unauthorised receipt proof before any write %j", async (change) => {
    const ctx = transaction(change);
    await expect(consumeWiseReceipt(ctx.tx, "attempt", "receipt", "digest", expected)).rejects.toThrow();
    expect(ctx.update).not.toHaveBeenCalled();
  });
});
