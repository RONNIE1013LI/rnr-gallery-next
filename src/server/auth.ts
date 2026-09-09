import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { oAuthProxy, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { staffPasskeyOptions } from "@/server/auth/staff-passkey-options";
import { staffSecurityPlugin } from "@/server/auth/staff-security-plugin";
import { encodeRecoveryCodes, generateStaffRecoveryCodes } from "@/server/auth/recovery-code-storage";

import { getDatabase } from "@/server/db/client";
import * as authSchema from "@/server/db/schema";
import {
  getAuthRateLimitOptions,
  getBetterAuthBaseURL,
  getLocalOAuthProxyOptions,
  parseAuthConfig,
} from "@/server/auth/config";
import { getSocialProviderOptions } from "@/server/auth/social-provider-config";
import { createPasswordResetEmailSender } from "@/server/auth/password-reset-email";
import { getWebsiteChatAuthOptions } from "@/server/auth/website-chat-storage";

import { staffSessionCreationHook, loadStaffSecurity, writeSecurityAudit } from "@/server/auth/staff-security-runtime";
import { createAccountThrottleHook } from "@/server/auth/account-throttle-runtime";

const authConfig = parseAuthConfig();
const localOAuthProxyOptions = getLocalOAuthProxyOptions(
  authConfig,
  process.env,
);

const websiteChatAuthOptions: BetterAuthOptions = getWebsiteChatAuthOptions();
const websiteChatHooks = websiteChatAuthOptions.databaseHooks;
export const auth = betterAuth({
  ...websiteChatAuthOptions,
  databaseHooks: {
    ...websiteChatHooks,
    session: {
      ...websiteChatHooks?.session,
      create: { before: staffSessionCreationHook },
    },
  },
  appName: "R&R Gallery",
  baseURL: getBetterAuthBaseURL(authConfig, process.env),
  secret: authConfig.secret,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema: authSchema,
  }),
  rateLimit: getAuthRateLimitOptions(),
  hooks: { before: createAccountThrottleHook() },
  verification: { storeInDatabase: true, storeIdentifier: { default: "plain", overrides: { "reset-password": "hashed" } } },
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }, request) => {
      if (await loadStaffSecurity(user.id)) await writeSecurityAudit({ event: "PASSWORD_RESET", userId: user.id, email: user.email, success: true, headers: request?.headers });
    },
    sendResetPassword: createPasswordResetEmailSender({
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    }),
  },
  socialProviders: getSocialProviderOptions(process.env),
  plugins: [
    ...(localOAuthProxyOptions ? [oAuthProxy(localOAuthProxyOptions)] : []),
    twoFactor({
      issuer: "R&R Gallery Staff",
      backupCodeOptions: {
        customBackupCodesGenerate: generateStaffRecoveryCodes,
        storeBackupCodes: { encrypt: encodeRecoveryCodes, decrypt: async (value) => value },
      },
    }),
    passkey(staffPasskeyOptions(authConfig.origin)),
    staffSecurityPlugin(),
    nextCookies(),
  ],
});
