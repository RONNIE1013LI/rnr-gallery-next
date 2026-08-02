import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { getDatabase } from "@/server/db/client";
import * as authSchema from "@/server/db/schema";
import { parseAuthConfig } from "@/server/auth/config";

const authConfig = parseAuthConfig();

export const auth = betterAuth({
  appName: "R&R Gallery",
  baseURL: authConfig.baseURL,
  secret: authConfig.secret,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
