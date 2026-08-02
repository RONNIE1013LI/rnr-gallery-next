import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  getUrgentService,
  InvalidNeededDateError,
} from "./urgent-service";

describe("urgent service schedule", () => {
  it("defaults to the fifth working day, skipping weekends", () => {
    expect(addWorkingDays("2026-08-03", 5)).toBe("2026-08-10");
    expect(addWorkingDays("2026-08-07", 5)).toBe("2026-08-14");
  });

  it.each([
    ["2026-08-04", 1, 8_000],
    ["2026-08-05", 2, 7_000],
    ["2026-08-06", 3, 6_000],
    ["2026-08-07", 4, 5_000],
    ["2026-08-10", 5, 0],
    ["2026-08-17", 10, 0],
  ])("maps %s to working day %i and fee %i", (neededDate, workingDays, fee) => {
    expect(getUrgentService("2026-08-03", neededDate)).toEqual({
      workingDays,
      feeInclGstCents: fee,
      requiresConfirmation: fee > 0,
    });
  });

  it("rejects same-day, past and invalid dates", () => {
    expect(() => getUrgentService("2026-08-03", "2026-08-03"))
      .toThrow(InvalidNeededDateError);
    expect(() => getUrgentService("2026-08-03", "2026-08-02"))
      .toThrow(InvalidNeededDateError);
    expect(() => getUrgentService("bad", "2026-08-04"))
      .toThrow(InvalidNeededDateError);
  });
});
