// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { staffSecurity, staffSecurityPolicy, staffSessionSecurity } from "@/server/db/schema";
import { assertStaffSecurity, canEnrollReplacementPasskey, markStrongStaffSession } from "./staff-security-runtime";

const database = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => database }));
const now = Date.parse("2026-11-03T00:00:00Z");
const minute = 60_000;
const current = {
  user: { id: "owner-test" },
  session: { id: "session-test", createdAt: new Date(now - 60 * minute), expiresAt: new Date(now + 60 * minute) },
};
let identity: { enabled: boolean; role: "owner" | "admin"; expiresAt: Date | null; createdAt: Date };
let security: { sessionId: string; userId: string; lastActiveAt: Date; mfaAt: Date | null; elevatedAt: Date | null; factor: string } | null;
let enforcedAt: Date | null;
let lastValues: Record<string, unknown>;
const revoke = vi.fn(async () => {});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  identity = { enabled: true, role: "owner", expiresAt: null, createdAt: new Date(now - 2 * minute) };
  enforcedAt = new Date(now - minute);
  security = { sessionId: current.session.id, userId: current.user.id, lastActiveAt: new Date(now - minute), mfaAt: new Date(now - minute), elevatedAt: null, factor: "passkey" };
  database.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({ limit: async () => {
    if (table === staffSecurityPolicy) return [{ rolloutAt: new Date(now - minute), enforcedAt }];
    if (table === staffSecurity) return [identity];
    if (table === staffSessionSecurity) {
      const { params } = new PgDialect().sqlToQuery(condition);
      return security && params.includes(security.sessionId) && params.includes(security.userId) ? [security] : [];
    }
    throw new Error("Unexpected table");
  } }) }) }));
  database.insert.mockImplementation(() => ({ values: (values: Record<string, unknown>) => {
    lastValues = values;
    return { onConflictDoNothing: async () => {}, onConflictDoUpdate: async () => {} };
  } }));
  database.update.mockImplementation(() => ({ set: () => ({ where: async () => {} }) }));
});
afterEach(() => vi.useRealTimers());

describe("staff runtime action and read authorization", () => {
  it("allows read access without recent elevation and keeps default writes sensitive", async () => {
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).resolves.toBe("owner");
    await expect(assertStaffSecurity(current, "manage_roles", false, revoke)).rejects.toMatchObject({ reason: "step_up_required" });
  });
  it("still requires MFA on read access and on first-login sessions", async () => {
    security!.mfaAt = null;
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "mfa_required" });
  });
  it("retains the staff role ceiling on read access", async () => {
    identity.role = "admin";
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves forced elevation for nonsensitive permissions", async () => {
    await expect(assertStaffSecurity(current, "access_admin", true, revoke)).rejects.toMatchObject({ reason: "step_up_required" });
    await expect(assertStaffSecurity(current, "access_admin", false, revoke)).resolves.toBe("owner");
  });
  it.each([10, 29, 30 - 1 / minute])("reuses the same verified session at %s minutes", async (age) => {
    security!.elevatedAt = new Date(now - age * minute);
    await expect(assertStaffSecurity(current, "manage_roles", false, revoke)).resolves.toBe("owner");
  });
  it.each([30, 30 + 1 / minute])("requires renewed verification at %s minutes", async (age) => {
    security!.elevatedAt = new Date(now - age * minute);
    await expect(assertStaffSecurity(current, "manage_roles", false, revoke)).rejects.toMatchObject({ reason: "step_up_required" });
  });
  it("does not carry verification into a different user or session", async () => {
    for (const session of [{ ...current, user: { id: "another-user" } }, { ...current, session: { ...current.session, id: "another-session" } }]) {
      await expect(assertStaffSecurity(session, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "expired" });
    }
  });
  it("rejects a session whose security marker was revoked", async () => {
    security = null;
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "expired" });
  });
  it("rejects disabled identities and expired native sessions on read access", async () => {
    identity.enabled = false;
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "disabled" });
    identity.enabled = true;
    await expect(assertStaffSecurity({ ...current, session: { ...current.session, expiresAt: new Date(now) } }, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "expired" });
    expect(revoke).toHaveBeenCalledWith(current.session.id);
  });
  it("keeps a new password session unverified", async () => {
    security!.mfaAt = null; security!.elevatedAt = null;
    await expect(assertStaffSecurity(current, "manage_roles", false, revoke)).rejects.toMatchObject({ reason: "mfa_required" });
  });
  it("does not grandfather Owner MFA during staged rollout", async () => {
    enforcedAt = null; identity.createdAt = new Date(now - 10 * minute); security!.mfaAt = null;
    await expect(assertStaffSecurity(current, "manage_roles", "read-only", revoke)).rejects.toMatchObject({ reason: "mfa_required" });
  });
});

describe("recovery remains narrowly limited to five minutes", () => {
  it.each([5 - 1 / minute, 5, 10, 29])("replacement enrollment grace at %s minutes", async (age) => {
    security!.factor = "recovery"; security!.mfaAt = new Date(now - age * minute);
    await expect(canEnrollReplacementPasskey({ ...current, session: { ...current.session, createdAt: new Date(now - age * minute) } })).resolves.toBe(age < 5);
  });
  it("requires both recovery verification and rotated session to be recent", async () => {
    security!.factor = "recovery";
    await expect(canEnrollReplacementPasskey(current)).resolves.toBe(false);
  });
  it("never creates broad elevation from a recovery code", async () => {
    await markStrongStaffSession(current, "recovery");
    expect(lastValues).toMatchObject({ userId: current.user.id, sessionId: current.session.id, elevatedAt: null, factor: "recovery" });
    security!.factor = "recovery";
    await expect(assertStaffSecurity(current, "manage_roles", false, revoke)).rejects.toMatchObject({ reason: "step_up_required" });
  });
});
