import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { getDatabase } from "@/server/db/client";
import * as authSchema from "@/server/db/schema";

export const auth = betterAuth({
  appName: "R&R Gallery",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
