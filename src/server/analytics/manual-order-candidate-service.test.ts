import { describe, expect, it, vi } from "vitest";
import {
  createDrizzleManualConversionCandidateReader,
  createManualConversionCandidateService,
  type ManualConversionCandidateReader,
} from "./manual-order-candidate-service";

const snapshot = {
  source: "manual" as const,
  customerSource: "whatsapp",
  jobNumber: "RRM-2026-SERVICE",
  manualPaymentStatus: "paid",
  amountPaidCents: 5_000,
  linkedOnlineOrder: false,
  invoice: { status: "issued" as const, currency: "NZD" as const, totalInclGstCents: 5_000 },
  customFields: {
    advertising_consent: "granted",
    advertising_consent_recorded_at: "2026-08-28T00:00:00.000Z",
    advertising_source: "whatsapp",
    fbclid: "meta-click",
  },
};

describe("manual conversion candidate service", () => {
  it("marks an exact Payment Request reference as linked before building a candidate", async () => {
    const selectionKeys: string[][] = [];
    const rows = [
      [{
        source: "manual",
        customerSource: "messenger",
        jobNumber: "RRM-2026-PAYMENT-REQUEST",
        manualPaymentStatus: "paid",
        amountPaidCents: 5_000,
        linkedOnlineOrderNumber: null,
        linkedPaymentRequestNumber: "PAY-2026-0001",
      }],
      [{ status: "issued", currency: "NZD", totalInclGstCents: 5_000 }],
      [],
    ];
    let selectIndex = 0;
    const database = {
      select: vi.fn((selection: Record<string, unknown>) => {
        selectionKeys.push(Object.keys(selection));
        const result = rows[selectIndex++];
        const query = {
          from: () => query,
          leftJoin: () => query,
          innerJoin: () => query,
          where: () => query,
          limit: async () => result,
          then: <TResult>(
            onfulfilled?: ((value: unknown) => TResult | PromiseLike<TResult>) | null,
            onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
          ) => Promise.resolve(result).then(onfulfilled, onrejected),
        };
        return query;
      }),
    };

    const reader = createDrizzleManualConversionCandidateReader(database as never);
    await expect(reader.findByJobId("00000000-0000-4000-8000-000000000008"))
      .resolves.toMatchObject({ linkedOnlineOrder: true });
    expect(selectionKeys[0]).toContain("linkedPaymentRequestNumber");
  });

  it("returns candidates from its narrow read-only snapshot reader without a dispatch surface", async () => {
    const reader: ManualConversionCandidateReader = {
      findByJobId: vi.fn().mockResolvedValue(snapshot),
    };
    const service = createManualConversionCandidateService(reader);

    await expect(service.list("00000000-0000-4000-8000-000000000006")).resolves.toEqual([{
      destination: "meta",
      transactionId: "manual:RRM-2026-SERVICE",
      currency: "NZD",
      value: 50,
      meta: { fbclid: "meta-click" },
    }]);
    expect(reader.findByJobId).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000006");
    expect("dispatch" in service).toBe(false);
    expect("markSent" in service).toBe(false);
  });

  it("returns no candidate when the reader finds no job", async () => {
    const service = createManualConversionCandidateService({ findByJobId: async () => null });
    await expect(service.list("00000000-0000-4000-8000-000000000007")).resolves.toEqual([]);
  });
});
