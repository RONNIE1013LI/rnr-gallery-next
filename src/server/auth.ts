import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { oAuthProxy } from "better-auth/plugins";

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

const authConfig = parseAuthConfig();
const localOAuthProxyOptions = getLocalOAuthProxyOptions(
  authConfig,
  process.env,
);

export const auth = betterAuth({
  appName: "R&R Gallery",
  baseURL: getBetterAuthBaseURL(authConfig, process.env),
  secret: authConfig.secret,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema: authSchema,
  }),
  rateLimit: getAuthRateLimitOptions(),
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: createPasswordResetEmailSender({
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    }),
  },
  socialProviders: getSocialProviderOptions(process.env),
  plugins: [
    ...(localOAuthProxyOptions ? [oAuthProxy(localOAuthProxyOptions)] : []),
    nextCookies(),
  ],
});
