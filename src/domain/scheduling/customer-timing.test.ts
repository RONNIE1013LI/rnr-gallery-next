import { describe, expect, it } from "vitest";
import { getCustomerTiming } from "./customer-timing";

describe("customer need-by planning", () => {
  it("reserves NZ transit time while retaining three business days from the order date", () => {
    expect(getCustomerTiming("2026-08-03", "2026-08-11", "NZ", "post")).toMatchObject({
      productionDate: "2026-08-06", estimatedArrivalStart: "2026-08-10", estimatedArrivalEnd: "2026-08-11", error: null,
    });
    expect(getCustomerTiming("2026-08-03", "2026-08-06", "NZ", "pickup")).toMatchObject({ productionDate: "2026-08-06", error: null });
  });
  it("keeps tight deadlines advisory without changing production service", () => {
    expect(getCustomerTiming("2026-08-03", "2026-08-10", "NZ", "post")).toMatchObject({ productionDate: "2026-08-06", error: expect.any(String) });
  });
  it("keeps standard production for impossible, past, missing and invalid dates", () => {
    for (const date of ["2026-08-03", "2026-08-02", "", "2026-02-30", "2026-08-04"]) {
      expect(getCustomerTiming("2026-08-03", date, "NZ", "post").productionDate).toBe("2026-08-06");
    }
  });
  it("uses the existing NZ public holiday calendar at year boundaries and weekends", () => {
    expect(getCustomerTiming("2026-12-23", "2027-01-07", "NZ", "post")).toMatchObject({ productionDate: "2026-12-30", estimatedArrivalEnd: "2027-01-06" });
    expect(getCustomerTiming("2026-08-07", "2026-08-16", "NZ", "pickup")).toMatchObject({ productionDate: "2026-08-12" });
  });
  it("reserves remote-area time for Australia without selecting a shipping service", () => {
    expect(getCustomerTiming("2026-08-03", "2026-08-20", "AU", "post")).toMatchObject({ productionDate: "2026-08-06", estimatedArrivalStart: "2026-08-13", estimatedArrivalEnd: "2026-08-20" });
  });
  it("does not force rush or block AU orders using the remote-area estimate before an address is known", () => {
    for (const date of ["2026-08-17", "2026-08-19", "2026-08-10"]) {
      expect(getCustomerTiming("2026-08-03", date, "AU", "post")).toMatchObject({ productionDate: "2026-08-06" });
    }
  });
  it("treats ISO dates as dates regardless of daylight-saving offset", () => {
    expect(getCustomerTiming("2026-09-25", "2026-10-05", "NZ", "post")).toMatchObject({ productionDate: "2026-09-30", estimatedArrivalEnd: "2026-10-05" });
  });
});
