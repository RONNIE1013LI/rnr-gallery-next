import { describe, expect, it, vi } from "vitest";
import type { ManualConversionCandidate } from "@/domain/analytics/manual-order-attribution";
import {
  createDrizzleManualConversionSuccessStore,
  createManualConversionDispatcher,
  createManualConversionObserver,
  type ManualConversionSuccessStore,
} from "./manual-conversion-dispatcher";

const actor = { userId: "staff-1", email: "staff@example.test" };
const jobId = "00000000-0000-4000-8000-000000000006";
const base = {
  transactionId: "manual:08000",
  paidAt: new Date("2026-08-28T01:02:03.000Z"),
  currency: "NZD" as const,
  value: 200,
};
const metaCandidate: ManualConversionCandidate = {
  ...base,
  destination: "meta",
  meta: {
    actionSource: "business_messaging",
    hashedEmail: "e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5",
  },
};
const googleCandidate: ManualConversionCandidate = {
  ...base,
  destination: "google",
  google: { clickId: "google-click_123", kind: "gclid" },
};

function memorySuccessStore(): ManualConversionSuccessStore {
  const completed = new Set<string>();
  return {
    async runOnce(input, operation) {
      const key = `${input.destination}:${input.transactionId}`;
      if (completed.has(key)) return "already_sent";
      const result = await operation();
      if (result === "sent") completed.add(key);
      return result;
    },
  };
}

describe("manual conversion dispatcher", () => {
  it("persists only a privacy-safe per-destination success audit", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      insert: vi.fn(() => ({ values })),
    };
    const database = {
      transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction)),
    };
    const store = createDrizzleManualConversionSuccessStore(database as never);

    await expect(store.runOnce({
      actor,
      jobId,
      destination: "google",
      ...base,
    }, vi.fn().mockResolvedValue("sent"))).resolves.toBe("sent");

    expect(values).toHaveBeenCalledOnce();
    const record = values.mock.calls[0][0];
    expect(record).toMatchObject({
      action: "analytics.manual_conversion.google.sent",
      resourceType: "production_job",
      resourceId: jobId,
      result: "success",
      idempotencyKey: "manual-conversion:google:manual:08000",
      afterSummary: {
        destination: "google",
        transactionId: "manual:08000",
        currency: "NZD",
        value: 200,
      },
    });
    expect(JSON.stringify(record)).not.toMatch(/google-click|fb\.1\.|access.?token|customer@example/i);
  });

  it("skips a provider call when the destination success audit already exists", async () => {
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "audit-1" }]) })),
        })),
      })),
      insert: vi.fn(),
    };
    const database = {
      transaction: vi.fn(async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction)),
    };
    const operation = vi.fn().mockResolvedValue("sent");

    await expect(createDrizzleManualConversionSuccessStore(database as never).runOnce({
      actor,
      jobId,
      destination: "meta",
      ...base,
    }, operation)).resolves.toBe("already_sent");

    expect(operation).not.toHaveBeenCalled();
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it("records success per destination and never repeats a successful destination", async () => {
    const metaSend = vi.fn().mockResolvedValue("sent");
    const googleSend = vi.fn().mockResolvedValue("sent");
    const dispatcher = createManualConversionDispatcher({
      listCandidates: vi.fn().mockResolvedValue([metaCandidate, googleCandidate]),
      successStore: memorySuccessStore(),
      metaSend,
      googleSend,
    });

    await expect(dispatcher.dispatch(jobId, actor)).resolves.toEqual({ meta: "sent", google: "sent" });
    await expect(dispatcher.dispatch(jobId, actor)).resolves.toEqual({ meta: "already_sent", google: "already_sent" });
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(googleSend).toHaveBeenCalledTimes(1);
    expect(metaSend).toHaveBeenCalledWith(expect.objectContaining({
      name: "Purchase",
      eventId: "purchase:manual:08000",
      eventTime: 1_787_878_923,
      currency: "NZD",
      value: 200,
      actionSource: "business_messaging",
      hashedEmail: metaCandidate.meta?.hashedEmail,
    }));
    expect(googleSend).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: "manual:08000",
      click: { id: "google-click_123", kind: "gclid" },
    }));
  });

  it("isolates failures and retries only the destination that has not succeeded", async () => {
    const metaSend = vi.fn().mockResolvedValueOnce("failed").mockResolvedValueOnce("sent");
    const googleSend = vi.fn().mockResolvedValue("sent");
    const dispatcher = createManualConversionDispatcher({
      listCandidates: vi.fn().mockResolvedValue([metaCandidate, googleCandidate]),
      successStore: memorySuccessStore(),
      metaSend,
      googleSend,
    });

    await expect(dispatcher.dispatch(jobId, actor)).resolves.toEqual({ meta: "failed", google: "sent" });
    await expect(dispatcher.dispatch(jobId, actor)).resolves.toEqual({ meta: "sent", google: "already_sent" });
    expect(metaSend).toHaveBeenCalledTimes(2);
    expect(googleSend).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed job update authoritative when scheduled dispatch fails", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const dispatch = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const observer = createManualConversionObserver((task) => tasks.push(task), dispatch);

    expect(() => observer(jobId, actor)).not.toThrow();
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(jobId, actor);
  });

  it("does not surface a scheduler failure after the business commit", () => {
    const observer = createManualConversionObserver(() => {
      throw new Error("request lifecycle closed");
    }, vi.fn());
    expect(() => observer(jobId, actor)).not.toThrow();
  });
});
