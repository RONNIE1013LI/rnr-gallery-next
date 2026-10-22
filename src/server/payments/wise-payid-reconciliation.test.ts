import { describe, expect, it, vi } from "vitest";
import { createWisePayIdWorker } from "./wise-payid-reconciliation";
const config = { token: "fixture", profileId: 1, balanceId: 2, autoMatch: true };
const receipt = { id: "receipt", digest: "digest", amountCents: 100, currency: "AUD", receivedAt: new Date(), status: "reserved", intentId: "attempt" };
const intent = { id: "attempt", amountCents: 100, currency: "AUD", reference: "RRA1234567812344234", merchantReference: "pending-order" };
const statement = { query: { currency: "AUD", profileId: 1 }, transactions: [] };
function setup(change = {}) {
  const repository = { hasPending: vi.fn(async () => true), claimPoll: vi.fn(async () => true), finishPoll: vi.fn(), holdForReview: vi.fn(), ingest: vi.fn(), candidates: vi.fn(async () => [receipt]), reserve: vi.fn(async () => ({ receipt, intent })) };
  const client = { statement: vi.fn(async () => statement) };
  const apply = vi.fn(async () => undefined);
  return { repository, client, apply, worker: createWisePayIdWorker({ config: { ...config, ...change }, repository, client, apply, now: () => new Date("2026-10-22T00:00:00Z") }) };
}
describe("Wise statement worker", () => {
  it("does no API request or poll write without pending intents", async () => {
    const ctx = setup(); ctx.repository.hasPending.mockResolvedValue(false);
    expect(await ctx.worker.run()).toMatchObject({ skipped: "no_pending" });
    expect(ctx.client.statement).not.toHaveBeenCalled(); expect(ctx.repository.claimPoll).not.toHaveBeenCalled();
  });
  it("throttles repeated runs across workers", async () => {
    const ctx = setup(); ctx.repository.claimPoll.mockResolvedValue(false);
    expect(await ctx.worker.run()).toMatchObject({ skipped: "cooldown" }); expect(ctx.client.statement).not.toHaveBeenCalled();
  });
  it("keeps orders pending until reference round trip is verified", async () => {
    const ctx = setup({ autoMatch: false }); ctx.repository.candidates.mockResolvedValue([{ ...receipt, status: "unmatched" }]);
    expect(await ctx.worker.run()).toMatchObject({ applied: 0, autoMatch: false }); expect(ctx.apply).not.toHaveBeenCalled(); expect(ctx.repository.reserve).not.toHaveBeenCalled();
  });
  it("passes durable receipt proof to the existing atomic order path", async () => {
    const ctx = setup();
    expect(await ctx.worker.run()).toMatchObject({ applied: 1 });
    expect(ctx.apply).toHaveBeenCalledWith({ attemptId: "attempt", source: "reconciliation", result: expect.objectContaining({ status: "paid", providerReference: intent.reference, wiseReceiptId: "receipt", wiseReceiptDigest: "digest", amountCents: 100, currency: "AUD" }) });
  });
  it("recovers a previously approved reservation even when new automatic matching is off", async () => {
    const ctx = setup({ autoMatch: false });
    expect(await ctx.worker.run()).toMatchObject({ applied: 1, autoMatch: false });
    expect(ctx.apply).toHaveBeenCalledOnce();
  });
  it("never confirms after an invalid or failed statement read", async () => {
    const ctx = setup(); ctx.client.statement.mockRejectedValue(new Error("private provider details"));
    await expect(ctx.worker.run()).rejects.toThrow("Wise reconciliation unavailable");
    expect(ctx.apply).not.toHaveBeenCalled(); expect(ctx.repository.finishPoll).toHaveBeenCalledWith(false);
  });
});
