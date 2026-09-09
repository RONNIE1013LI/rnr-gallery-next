import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { passkey } from "@/server/db/schema";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { validStaffPassword } from "./staff-password-policy";
import { recoveryCodeForVerification } from "./recovery-code-storage";
import { assertStaffSecurity, canEnrollReplacementPasskey, loadStaffSecurity, markStrongStaffSession, writeSecurityAudit } from "./staff-security-runtime";

const factors: Readonly<Record<string, "passkey" | "totp" | "recovery">> = {
  "/passkey/verify-authentication": "passkey",
  "/two-factor/verify-totp": "totp",
  "/two-factor/verify-backup-code": "recovery",
};
const sensitive = new Set([
  "/change-password", "/change-email", "/two-factor/disable", "/two-factor/generate-backup-codes",
  "/passkey/delete-passkey", "/revoke-sessions", "/revoke-other-sessions", "/delete-user",
]);
const events: Readonly<Record<string, string>> = {
  "/passkey/verify-registration": "PASSKEY_ADDED",
  "/passkey/delete-passkey": "PASSKEY_REMOVED",
  "/two-factor/generate-backup-codes": "RECOVERY_CODES_REGENERATED",
  "/change-password": "PASSWORD_CHANGED", "/change-email": "SECURITY_SETTING_CHANGED",
  "/revoke-session": "SESSION_REVOKED", "/revoke-sessions": "ALL_SESSIONS_REVOKED",
  "/revoke-other-sessions": "ALL_SESSIONS_REVOKED", "/sign-out": "SESSION_REVOKED",
};

export function staffSecurityPlugin(): BetterAuthPlugin {
  return {
    id: "rnr-staff-security",
    hooks: {
      before: [{ matcher: () => true, handler: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
          const signed = await getSessionFromCtx(ctx);
          const reset = ctx.path === "/reset-password" && typeof ctx.body?.token === "string"
            ? await ctx.context.internalAdapter.findVerificationValue(`reset-password:${ctx.body.token}`) : null;
          const userId = reset?.value ?? signed?.user.id;
          if (userId && await loadStaffSecurity(userId) && !validStaffPassword(ctx.body?.newPassword)) {
            throw new APIError("BAD_REQUEST", { message: "Use a less common passphrase of 12 to 128 characters." });
          }
        }
        if (factors[ctx.path]) {
          const initial = await getSessionFromCtx(ctx);
          (ctx.context as typeof ctx.context & { rnrFallbackLogin?: boolean; rnrTotpEnrollment?: boolean }).rnrFallbackLogin = !initial;
          (ctx.context as typeof ctx.context & { rnrTotpEnrollment?: boolean }).rnrTotpEnrollment = ctx.path === "/two-factor/verify-totp" && Boolean(initial && !(initial.user as { twoFactorEnabled?: boolean }).twoFactorEnabled);
        }
        if (ctx.path.startsWith("/two-factor/") && ctx.body) {
          ctx.body.trustDevice = false;
          if (ctx.path === "/two-factor/verify-backup-code") {
            try { ctx.body.code = recoveryCodeForVerification(ctx.body.code); }
            catch { throw new APIError("UNAUTHORIZED", { message: "Invalid verification code." }); }
            ctx.body.disableSession = false;
          }
        }
        const managesFactors = ctx.path.startsWith("/passkey/") && !["/passkey/generate-authenticate-options", "/passkey/verify-authentication"].includes(ctx.path);
        if (!sensitive.has(ctx.path) && !managesFactors && !["/two-factor/enable", "/two-factor/get-totp-uri"].includes(ctx.path)) return;
        const current = await getSessionFromCtx(ctx);
        if (!current) return; // The official endpoint enforces its session requirement.
        const staff = await loadStaffSecurity(current.user.id);
        if (!staff) return;
        if (!staff.enabled) throw new APIError("FORBIDDEN", { message: "Account access is unavailable." });
        if (ctx.path === "/delete-user" || ctx.path === "/two-factor/disable") {
          await assertStaffSecurity(current, undefined, true);
          throw new APIError("FORBIDDEN", { message: "Staff authentication cannot be removed while staff access is enabled." });
        }
        if (ctx.path === "/two-factor/get-totp-uri" && (current.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
          throw new APIError("FORBIDDEN", { message: "Stored authenticator secrets cannot be displayed again." });
        }
        const keys = await getDatabase().select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, current.user.id)).limit(1);
        const factorAlreadyEnabled = Boolean((current.user as { twoFactorEnabled?: boolean }).twoFactorEnabled || keys.length);
        if (sensitive.has(ctx.path) || (managesFactors && factorAlreadyEnabled) || (ctx.path === "/two-factor/enable" && factorAlreadyEnabled)) {
          try { await assertStaffSecurity(current, undefined, true); }
          catch {
            const replacementRegistration = ["/passkey/generate-register-options", "/passkey/verify-registration"].includes(ctx.path);
            if (!replacementRegistration || !await canEnrollReplacementPasskey(current)) throw new APIError("FORBIDDEN", { message: "Verify your identity at Account Security before this action." });
          }
        }
      }) }],
      after: [{ matcher: () => true, handler: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        if (ctx.path === "/passkey/generate-authenticate-options" && returned && !(returned instanceof APIError)) {
          return ctx.json({ ...(returned as object), userVerification: "required" });
        }
        const factor = factors[ctx.path];
        const event = factor ? (factor === "recovery" ? "RECOVERY_CODE_USED" : "MFA_SUCCESS") : events[ctx.path];
        if (!event && ctx.path !== "/sign-in/email") return;
        if (returned instanceof APIError) {
          await writeSecurityAudit({ event: factor ? "MFA_FAILED" : event ?? "LOGIN_FAILED", success: false, headers: ctx.headers });
          return;
        }
        if (ctx.path === "/sign-in/email") {
          if ((returned as { twoFactorRedirect?: boolean })?.twoFactorRedirect) return;
          const current = ctx.context.newSession;
          if (current && await loadStaffSecurity(current.user.id)) await writeSecurityAudit({ event: "LOGIN_SUCCESS", userId: current.user.id, email: current.user.email, success: true, headers: ctx.headers });
          return;
        }
        let current = ctx.context.newSession ?? await getSessionFromCtx(ctx);
        if (!current) return;
        if (factor && await loadStaffSecurity(current.user.id)) {
          // TOTP verification on an already authenticated session must rotate too.
          if (!ctx.context.newSession) {
            const replacement = await ctx.context.internalAdapter.createSession(current.user.id);
            if (!replacement) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not establish a secure session." });
            await ctx.context.internalAdapter.deleteSession(current.session.token);
            current = { user: current.user, session: replacement };
            await setSessionCookie(ctx, current);
          }
          const fallbackLogin = (ctx.context as typeof ctx.context & { rnrFallbackLogin?: boolean }).rnrFallbackLogin === true;
          await markStrongStaffSession(current, factor, fallbackLogin);
          if (fallbackLogin) await writeSecurityAudit({ event: "LOGIN_SUCCESS", userId: current.user.id, email: current.user.email, success: true, headers: ctx.headers });
          if ((ctx.context as typeof ctx.context & { rnrTotpEnrollment?: boolean }).rnrTotpEnrollment) await writeSecurityAudit({ event: "TOTP_ENABLED", userId: current.user.id, email: current.user.email, success: true, headers: ctx.headers });
        }
        if (ctx.path === "/change-password") await ctx.context.internalAdapter.deleteUserSessions(current.user.id);
        await writeSecurityAudit({ event, userId: current.user.id, email: current.user.email, success: true, headers: ctx.headers });
      }) }],
    },
  };
}
