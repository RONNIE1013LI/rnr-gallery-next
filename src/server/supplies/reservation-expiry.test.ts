import { describe, expect, it } from "vitest";
import { canExpireSupplyReservation } from "./reservation-expiry-policy";
const now = new Date("2026-10-13T01:00:00Z");
const stale = { status: "reserved", expiresAt: new Date("2026-10-13T00:30:00Z"), paymentStatus: "awaiting_payment", attempts: [], flikSessions: [] };
describe("bounded abandoned supply reservations", () => {
  it("expires a stock hold when the customer closed after order creation without starting payment", () => {
    expect(canExpireSupplyReservation(stale, now)).toBe(true);
  });
  it("expires setup failures with no provider reference once their creation lease ended", () => {
    expect(canExpireSupplyReservation({ ...stale, attempts: [{ status: "created", providerReference: null, providerSessionLeaseExpiresAt: new Date("2026-10-13T00:31:00Z") }] }, now)).toBe(true);
  });
  it("never expires paid/refunded stock, a released hold or a not-yet-due hold", () => {
    for (const paymentStatus of ["paid", "refunded"]) expect(canExpireSupplyReservation({ ...stale, paymentStatus }, now)).toBe(false);
    expect(canExpireSupplyReservation({ ...stale, status: "released" }, now)).toBe(false);
    expect(canExpireSupplyReservation({ ...stale, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(false);
  });
  it("does not expire a real PSP payment link or a live creation lease", () => {
    expect(canExpireSupplyReservation({ ...stale, attempts: [{ status: "requires_action", providerReference: "fixture-link", providerSessionLeaseExpiresAt: null }] }, now)).toBe(false);
    expect(canExpireSupplyReservation({ ...stale, attempts: [{ status: "created", providerReference: null, providerSessionLeaseExpiresAt: new Date(now.getTime() + 1) }] }, now)).toBe(false);
  });
  it("protects a durable Flik binding before the common attempt is bound", () => {
    expect(canExpireSupplyReservation({ ...stale, flikSessions: [{ providerReference: "fixture-link", appliedAt: null, creationLeaseExpiresAt: null }] }, now)).toBe(false);
  });
});
