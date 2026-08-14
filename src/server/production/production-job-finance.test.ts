import { describe, expect, it } from "vitest";
import { projectWebOrderFinance } from "./production-job-finance";

describe("web production finance", () => {
  it.each([
    ["awaiting_payment", { amountPaidCents: 0, amountOwingCents: 12_000 }],
    ["processing", { amountPaidCents: 0, amountOwingCents: 12_000 }],
    ["failed", { amountPaidCents: 0, amountOwingCents: 12_000 }],
    ["paid", { amountPaidCents: 12_000, amountOwingCents: 0 }],
    ["refunded", { amountPaidCents: 12_000, amountOwingCents: 0 }],
    ["cancelled", { amountPaidCents: 0, amountOwingCents: 0 }],
  ] as const)("projects %s without turning terminal orders into debt", (paymentStatus, expected) => {
    expect(projectWebOrderFinance(12_000, paymentStatus)).toMatchObject({
      amountPayableCents: 12_000,
      ...expected,
    });
  });
});
