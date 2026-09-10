// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { twoFactor } from "better-auth/plugins";
import { symmetricDecrypt } from "better-auth/crypto";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { encodeRecoveryCodes, generateStaffRecoveryCodes } from "./recovery-code-storage";
import { staffSecurityPlugin } from "./staff-security-plugin";
import { staffPasskeyOptions } from "./staff-passkey-options";
import { assertStaffSecurity, staffSessionCreationHook } from "./staff-security-runtime";
import { syntheticAuthenticator } from "./webauthn-test-fixture";
import { getStaffSecurity, postStaffSecurity } from "./staff-security-http";
import { createDrizzleAdminEmployeeRepository } from "@/server/admin/admin-employee-service";
import { changeStaffSecurity } from "./staff-management";
import { getPasswordResetTokenStatus } from "./password-reset-token";

const dbHolder = vi.hoisted(() => ({ value: null as unknown, auth: null as unknown }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => dbHolder.value }));
vi.mock("@/server/auth", () => ({ get auth() { return dbHolder.auth; } }));
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const db = drizzle(url, { schema });
dbHolder.value = db;
const ids: string[] = [];
const secret = `synthetic-security-test-${randomUUID()}`;
const origin = "http://localhost:3000";
let resetToken: string | undefined;
const testAuth = betterAuth({
  baseURL: origin, secret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  verification: { storeInDatabase: true, storeIdentifier: { default: "plain", overrides: { "reset-password": "hashed" } } },
  emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true, sendResetPassword: async ({ token }) => { resetToken = token; } },
  databaseHooks: { session: { create: { before: staffSessionCreationHook } } },
  rateLimit: { enabled: false }, // Redis account/IP throttling has its own tests.
  plugins: [twoFactor({ backupCodeOptions: { customBackupCodesGenerate: generateStaffRecoveryCodes, storeBackupCodes: { encrypt: encodeRecoveryCodes, decrypt: async (value) => value } } }), passkeyPlugin(staffPasskeyOptions(origin)), staffSecurityPlugin()],
});
dbHolder.auth = testAuth;
function cookie(response: Response) {
  return response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
}
function headers(value: string) { return new Headers({ cookie: value, origin }); }
const authenticator = syntheticAuthenticator();
const password = "synthetic test passphrase 2026";
let actor: { id: string; email: string; cookie: string; totp: string; codes: string[] };

beforeAll(async () => {
  const email = `security-${randomUUID()}@example.test`;
  const response = await testAuth.api.signUpEmail({ body: { name: "Synthetic security test", email, password }, asResponse: true });
  expect(response.status).toBe(200);
  const data = await response.json();
  ids.push(data.user.id);
  await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, data.user.id));
  await db.insert(schema.staffSecurity).values({ userId: data.user.id, role: "owner" });
  const enrollment = await testAuth.api.enableTwoFactor({ body: { password }, headers: headers(cookie(response)) });
  const [factor] = await db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, data.user.id));
  actor = { id: data.user.id, email, cookie: cookie(response), totp: await symmetricDecrypt({ key: secret, data: factor.secret }), codes: enrollment.backupCodes };
}, 15000);

afterAll(async () => {
  if (ids.length) {
    await db.delete(schema.staffSecurityPolicy).where(inArray(schema.staffSecurityPolicy.activatedBy, ids));
    await db.delete(schema.staffSessionSecurity).where(inArray(schema.staffSessionSecurity.userId, ids));
    await db.delete(schema.staffSecurity).where(inArray(schema.staffSecurity.userId, ids));
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.actorUserId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }
  await db.$client.end();
});

describe("official authentication library with PostgreSQL staff security", () => {
  it("stores encrypted TOTP and only hashed recovery codes", async () => {
    const [row] = await db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, actor.id));
    expect(row.secret).not.toBe(actor.totp);
    expect(row.secret).not.toContain(actor.totp);
    expect(JSON.parse(row.backupCodes).every((value: string) => /^sha256:[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(row.backupCodes).not.toContain(actor.codes[0]);
  });
  it("denies incorrect TOTP, enables with a correct TOTP, and rotates the session", async () => {
    await expect(testAuth.api.verifyTOTP({ body: { code: "invalid" }, headers: headers(actor.cookie) })).rejects.toThrow();
    const { code } = await testAuth.api.generateTOTP({ body: { secret: actor.totp } });
    const response = await testAuth.api.verifyTOTP({ body: { code }, headers: headers(actor.cookie), asResponse: true });
    expect(response.status).toBe(200);
    const old = actor.cookie; actor.cookie = cookie(response);
    expect(actor.cookie).not.toBe(old);
    expect(await testAuth.api.getSession({ headers: headers(old) })).toBeNull();
    const [staff] = await db.select().from(schema.staffSecurity).where(eq(schema.staffSecurity.userId, actor.id));
    expect(staff.fallbackVerifiedAt).toBeNull();
  });
  it("does not grant a normal session to password-only sign-in once MFA is enabled", async () => {
    const response = await testAuth.api.signInEmail({ body: { email: actor.email, password }, asResponse: true });
    expect((await response.json()).twoFactorRedirect).toBe(true);
    const pending = cookie(response);
    expect(await testAuth.api.getSession({ headers: headers(pending) })).toBeNull();
    await expect(testAuth.api.verifyTOTP({ body: { code: "invalid" }, headers: headers(pending) })).rejects.toThrow();
    const { code } = await testAuth.api.generateTOTP({ body: { secret: actor.totp } });
    const verified = await testAuth.api.verifyTOTP({ body: { code }, headers: headers(pending), asResponse: true });
    expect(verified.status).toBe(200); actor.cookie = cookie(verified);
    expect(await testAuth.api.getSession({ headers: headers(actor.cookie) })).not.toBeNull();
    await expect(testAuth.api.verifyTOTP({ body: { code }, headers: headers(pending) })).rejects.toThrow();
    const [staff] = await db.select().from(schema.staffSecurity).where(eq(schema.staffSecurity.userId, actor.id));
    expect(staff.fallbackVerifiedAt).not.toBeNull();
  });
  it("consumes one recovery code atomically across concurrent verification requests", async () => {
    const signIn = await testAuth.api.signInEmail({ body: { email: actor.email, password }, asResponse: true });
    const pending = cookie(signIn);
    const attempts = await Promise.all([0, 1].map(() => testAuth.api.verifyBackupCode({ body: { code: actor.codes[0] }, headers: headers(pending), asResponse: true })));
    expect(attempts.filter((response) => response.status === 200)).toHaveLength(1);
    const again = await testAuth.api.signInEmail({ body: { email: actor.email, password }, asResponse: true });
    const reused = await testAuth.api.verifyBackupCode({ body: { code: actor.codes[0] }, headers: headers(cookie(again)), asResponse: true });
    expect(reused.status).not.toBe(200);
  });
  it("registers and authenticates a cryptographically signed, user-verified Passkey", async () => {
    const optionsResponse = await testAuth.api.generatePasskeyRegistrationOptions({ headers: headers(actor.cookie), asResponse: true });
    const options = await optionsResponse.json();
    expect(options.authenticatorSelection.userVerification).toBe("required");
    const registered = await testAuth.api.verifyPasskeyRegistration({ headers: headers(`${actor.cookie}; ${cookie(optionsResponse)}`), body: { response: authenticator.register(options.challenge, origin, "localhost"), name: "Synthetic key" }, asResponse: true });
    expect(registered.status).toBe(200);
    const authentication = await testAuth.api.generatePasskeyAuthenticationOptions({ asResponse: true });
    const challenge = await authentication.json();
    expect(challenge.userVerification).toBe("required");
    const signed = authenticator.authenticate(challenge.challenge, origin, "localhost");
    const verified = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: signed }, asResponse: true });
    expect(verified.status).toBe(200); actor.cookie = cookie(verified);
    const replayed = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: signed }, asResponse: true });
    expect(replayed.status).not.toBe(200);
  });
  it.each([
    ["wrong origin", "https://rrgallery.co.nz", "localhost", true],
    ["wrong RP ID", origin, "rrgallery.co.nz", true],
    ["missing user verification", origin, "localhost", false],
  ])("rejects a signed Passkey with %s", async (_label, responseOrigin, rpId, verified) => {
    const authentication = await testAuth.api.generatePasskeyAuthenticationOptions({ asResponse: true });
    const options = await authentication.json();
    const response = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: authenticator.authenticate(options.challenge, responseOrigin, rpId, verified) }, asResponse: true });
    expect(response.status).not.toBe(200);
    expect(await testAuth.api.getSession({ headers: headers(cookie(response)) })).toBeNull();
  });
  it("rejects an expired WebAuthn challenge", async () => {
    const authentication = await testAuth.api.generatePasskeyAuthenticationOptions({ asResponse: true });
    const options = await authentication.json();
    await db.update(schema.verification).set({ expiresAt: new Date(0) }).where(like(schema.verification.value, `%${options.challenge}%`));
    const response = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: authenticator.authenticate(options.challenge, origin, "localhost") }, asResponse: true });
    expect(response.status).not.toBe(200);
  });
  it("requires step-up for MFA disable and protects the last Owner", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    expect(current).not.toBeNull();
    await db.insert(schema.staffSecurityPolicy).values({ id: "primary", rolloutAt: new Date(Date.now() - 1000), activatedBy: actor.id });
    await expect(changeStaffSecurity(current!, actor.id, { role: "admin", enabled: true, expiresAt: null }, async () => {})).rejects.toMatchObject({ status: 409 });
    await db.update(schema.staffSessionSecurity).set({ elevatedAt: null }).where(eq(schema.staffSessionSecurity.sessionId, current!.session.id));
    await expect(testAuth.api.disableTwoFactor({ body: { password }, headers: headers(actor.cookie) })).rejects.toThrow();
    await expect(assertStaffSecurity(current!, undefined, true)).rejects.toMatchObject({ reason: "step_up_required" });
  });
  it("protects the security API from cross-origin requests and hides raw credentials", async () => {
    vi.stubEnv("BETTER_AUTH_URL", origin); vi.stubEnv("BETTER_AUTH_SECRET", secret);
    try {
      for (const originHeader of ["https://attacker.invalid", "null", ""]) {
        const response = await postStaffSecurity(new Request(`${origin}/api/admin/security`, { method: "POST", headers: { cookie: actor.cookie, origin: originHeader, "content-type": "application/json" }, body: JSON.stringify({ action: "revoke-others" }) }));
        expect(response.status).toBe(403);
      }
      const response = await getStaffSecurity(new Request(`${origin}/api/admin/security`, { headers: headers(actor.cookie) }));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions.length).toBeGreaterThan(0);
      expect(data.sessions.every((item: object) => !Object.hasOwn(item, "token"))).toBe(true);
      expect(Object.hasOwn(data, "backupCodes")).toBe(false);
      expect(Object.hasOwn(data, "secret")).toBe(false);
      const denied = await postStaffSecurity(new Request(`${origin}/api/admin/security`, { method: "POST", headers: { cookie: actor.cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "revoke-others" }) }));
      expect(denied.status).toBe(401); // Previous test deliberately removed step-up.
    } finally { vi.unstubAllEnvs(); }
  });
  it("demotes an administrator to a bounded staff profile and revokes sessions", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await db.update(schema.staffSessionSecurity).set({ elevatedAt: new Date() }).where(eq(schema.staffSessionSecurity.sessionId, current!.session.id));
    const response = await testAuth.api.signUpEmail({ body: { name: "Synthetic designer", email: `security-${randomUUID()}@example.test`, password }, asResponse: true });
    const data = await response.json(); ids.push(data.user.id);
    await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, data.user.id));
    await db.insert(schema.staffSecurity).values({ userId: data.user.id, role: "admin" });
    const context = await testAuth.$context;
    await changeStaffSecurity(current!, data.user.id, { role: "designer", enabled: true, expiresAt: null }, (id) => context.internalAdapter.deleteUserSessions(id));
    const [updated] = await db.select().from(schema.user).where(eq(schema.user.id, data.user.id));
    const [profile] = await db.select().from(schema.adminStaffAccess).where(eq(schema.adminStaffAccess.userId, data.user.id));
    expect(updated.role).toBe("staff");
    expect(profile?.adminPermissions).toContain("upload_production_files");
    expect(profile?.adminPermissions).not.toContain("manage_payment");
    expect(profile?.assignedOnly).toBe(true);
    expect(await testAuth.api.getSession({ headers: headers(cookie(response)) })).toBeNull();
  });
  it("keeps Payment Requests available during a trusted Staff session without repeated step-up", async () => {
    const response = await testAuth.api.signUpEmail({ body: { name: "Synthetic order staff", email: `security-${randomUUID()}@example.test`, password }, asResponse: true });
    const data = await response.json(); ids.push(data.user.id);
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, data.user.id));
    await db.insert(schema.staffSecurity).values({ userId: data.user.id, role: "staff" });
    const current = await testAuth.api.getSession({ headers: headers(cookie(response)) });
    await db.insert(schema.staffSessionSecurity).values({ sessionId: current!.session.id, userId: data.user.id, mfaAt: new Date(), elevatedAt: null, lastActiveAt: new Date(), factor: "totp" });
    await expect(assertStaffSecurity(current!, "manage_payment")).resolves.toBe("staff");
    await expect(assertStaffSecurity(current!, "manage_roles")).rejects.toBeDefined();
    await expect(assertStaffSecurity(current!, undefined, true)).rejects.toMatchObject({ reason: "step_up_required" });
  });
  it("preserves a custom Staff access profile when disabling or reactivating without a role change", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await db.update(schema.staffSessionSecurity).set({ elevatedAt: new Date() }).where(eq(schema.staffSessionSecurity.sessionId, current!.session.id));
    const response = await testAuth.api.signUpEmail({ body: { name: "Synthetic custom staff", email: `security-${randomUUID()}@example.test`, password }, asResponse: true });
    const data = await response.json(); ids.push(data.user.id);
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, data.user.id));
    await db.insert(schema.staffSecurity).values({ userId: data.user.id, role: "staff" });
    const profile = { adminPermissions: ["access_admin", "view_orders"] as ("access_admin" | "view_orders")[], formPermissions: { access_forms: true, view_jobs: true }, assignedOnly: true };
    await db.insert(schema.adminStaffAccess).values({ userId: data.user.id, ...profile });
    const context = await testAuth.$context;
    for (const enabled of [false, true]) {
      await changeStaffSecurity(current!, data.user.id, { role: "staff", enabled, expiresAt: null }, (id) => context.internalAdapter.deleteUserSessions(id));
      const [stored] = await db.select().from(schema.adminStaffAccess).where(eq(schema.adminStaffAccess.userId, data.user.id));
      expect(stored).toMatchObject(profile);
    }
    expect(await testAuth.api.getSession({ headers: headers(cookie(response)) })).toBeNull();
  });
  it("blocks legacy initial-password staff creation after policy activation", async () => {
    const repository = createDrizzleAdminEmployeeRepository(db);
    await expect(repository.create({ userId: actor.id, email: actor.email }, {
      name: "Synthetic blocked", email: "blocked@example.test", passwordHash: "unused-test-hash", idempotencyKey: randomUUID(),
      profile: { adminPermissions: ["access_admin"], formPermissions: {} as never, assignedOnly: true },
    }, async () => false)).rejects.toThrow("Use staff invitations");
  });
  it("prevents an Admin from promoting themselves to Owner", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await db.update(schema.staffSecurity).set({ role: "admin" }).where(eq(schema.staffSecurity.userId, actor.id));
    try {
      await expect(changeStaffSecurity(current!, actor.id, { role: "owner", enabled: true, expiresAt: null }, async () => {})).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.update(schema.staffSecurity).set({ role: "owner" }).where(eq(schema.staffSecurity.userId, actor.id));
    }
  });
  it("revokes a native session when the staff idle limit expires", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await db.update(schema.staffSessionSecurity).set({ lastActiveAt: new Date(Date.now() - 3600_000) }).where(eq(schema.staffSessionSecurity.sessionId, current!.session.id));
    await expect(assertStaffSecurity(current!, "view_orders")).rejects.toMatchObject({ reason: "expired" });
    expect(await testAuth.api.getSession({ headers: headers(actor.cookie) })).toBeNull();
    const authentication = await testAuth.api.generatePasskeyAuthenticationOptions({ asResponse: true });
    const options = await authentication.json();
    const login = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: authenticator.authenticate(options.challenge, origin, "localhost") }, asResponse: true });
    expect(login.status).toBe(200); actor.cookie = cookie(login);
  });
  it("allows recovery-code sign-in to enroll a replacement Passkey without granting broad step-up", async () => {
    const signed = await testAuth.api.signInEmail({ body: { email: actor.email, password }, asResponse: true });
    const recovered = await testAuth.api.verifyBackupCode({ body: { code: actor.codes[1] }, headers: headers(cookie(signed)), asResponse: true });
    expect(recovered.status).toBe(200); actor.cookie = cookie(recovered);
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await expect(assertStaffSecurity(current!, undefined, true)).rejects.toMatchObject({ reason: "step_up_required" });
    const optionsResponse = await testAuth.api.generatePasskeyRegistrationOptions({ headers: headers(actor.cookie), asResponse: true });
    expect(optionsResponse.status).toBe(200);
    const options = await optionsResponse.json();
    const replacement = syntheticAuthenticator();
    const registration = await testAuth.api.verifyPasskeyRegistration({ headers: headers(`${actor.cookie}; ${cookie(optionsResponse)}`), body: { response: replacement.register(options.challenge, origin, "localhost"), name: "Synthetic recovery replacement" }, asResponse: true });
    expect(registration.status).toBe(200);
    await expect(assertStaffSecurity(current!, undefined, true)).rejects.toMatchObject({ reason: "step_up_required" });
    await db.update(schema.staffSessionSecurity).set({ mfaAt: new Date(Date.now() - 5 * 60_000) }).where(eq(schema.staffSessionSecurity.sessionId, current!.session.id));
    await expect(testAuth.api.generatePasskeyRegistrationOptions({ headers: headers(actor.cookie) })).rejects.toThrow();
  });
  it("hashes and consumes reset tokens without bypassing MFA, and revokes old sessions", async () => {
    await testAuth.api.requestPasswordReset({ body: { email: actor.email, redirectTo: `${origin}/account/reset-password` } });
    expect(Boolean(resetToken)).toBe(true);
    expect(await getPasswordResetTokenStatus(resetToken!)).toBe("valid");
    expect(await getPasswordResetTokenStatus(resetToken!)).toBe("valid");
    const rows = await db.select({ identifier: schema.verification.identifier }).from(schema.verification);
    expect(rows.some((row) => row.identifier.includes(resetToken!))).toBe(false);
    await expect(testAuth.api.resetPassword({ body: { token: resetToken!, newPassword: "password123456" } })).rejects.toThrow();
    const nextPassword = "another synthetic staff passphrase";
    const reset = await testAuth.api.resetPassword({ body: { token: resetToken!, newPassword: nextPassword }, asResponse: true });
    expect(reset.status).toBe(200);
    expect(await getPasswordResetTokenStatus(resetToken!)).toBe("invalid");
    expect(await testAuth.api.getSession({ headers: headers(actor.cookie) })).toBeNull();
    const reused = await testAuth.api.resetPassword({ body: { token: resetToken!, newPassword: nextPassword }, asResponse: true });
    expect(reused.status).not.toBe(200);
    const signed = await testAuth.api.signInEmail({ body: { email: actor.email, password: nextPassword }, asResponse: true });
    expect((await signed.json()).twoFactorRedirect).toBe(true);
    expect(await testAuth.api.getSession({ headers: headers(cookie(signed)) })).toBeNull();
    const authentication = await testAuth.api.generatePasskeyAuthenticationOptions({ asResponse: true });
    const options = await authentication.json();
    const login = await testAuth.api.verifyPasskeyAuthentication({ headers: headers(cookie(authentication)), body: { response: authenticator.authenticate(options.challenge, origin, "localhost") }, asResponse: true });
    expect(login.status).toBe(200); actor.cookie = cookie(login);
  });
  it("denies a disabled staff member even with a valid native auth session", async () => {
    const current = await testAuth.api.getSession({ headers: headers(actor.cookie) });
    await db.update(schema.staffSecurity).set({ enabled: false }).where(eq(schema.staffSecurity.userId, actor.id));
    await expect(assertStaffSecurity(current!, "view_orders")).rejects.toMatchObject({ reason: "disabled" });
    const login = await testAuth.api.signInEmail({ body: { email: actor.email, password: "another synthetic staff passphrase" }, asResponse: true });
    expect(login.status).not.toBe(200);
  });
});
