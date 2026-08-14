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

  it("skips New Zealand public holidays and Auckland Anniversary Day", () => {
    expect(addWorkingDays("2026-12-18", 5)).toBe("2026-12-29");
    expect(addWorkingDays("2026-01-23", 1)).toBe("2026-01-27");
  });

  it("counts Matariki as a non-working day when pricing urgent service", () => {
    expect(getUrgentService("2026-07-07", "2026-07-13")).toEqual({
      workingDays: 3,
      feeInclGstCents: 6_000,
      requiresConfirmation: true,
    });
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
