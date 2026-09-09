import { Redis } from "@upstash/redis";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { ACCOUNT_THROTTLE_WINDOW_SECONDS, CONSUME_ACCOUNT_ATTEMPT_SCRIPT, createAccountThrottle } from "./account-throttle";

export function createAccountThrottleHook(env: NodeJS.ProcessEnv = process.env) {
  // Construct lazily so static rendering does not depend on the auth Redis.
  let throttle: ReturnType<typeof createAccountThrottle> | undefined;
  return createAuthMiddleware(async (context) => {
    const emailPath = ["/sign-in/email", "/sign-up/email", "/request-password-reset"].includes(context.path);
    const factorPath = context.path.startsWith("/two-factor/") || context.path.startsWith("/passkey/");
    if (!emailPath && !factorPath && context.path !== "/reset-password") return;
    try {
      if (!throttle) {
        const url = env.RNR_AI_REDIS_REST_URL?.trim();
        const token = env.RNR_AI_REDIS_REST_TOKEN?.trim();
        const namespace = env.RNR_AI_REDIS_NAMESPACE?.trim();
        const secret = env.BETTER_AUTH_SECRET?.trim();
        if (!url || !token || !namespace || !secret) throw new Error("Authentication throttle configuration is unavailable");
        const redis = new Redis({ url, token });
        throttle = createAccountThrottle({
          secret,
          consume: async (key, seconds) => {
            const result = await redis.eval(CONSUME_ACCOUNT_ATTEMPT_SCRIPT, [`${namespace}:${key}`], [seconds]);
            if (typeof result !== "number") throw new Error("Invalid throttle response");
            return result;
          },
        });
      }
      let identity = context.body;
      if (!emailPath) {
        let userId = (await getSessionFromCtx(context))?.user.id;
        if (!userId && context.path.startsWith("/two-factor/")) {
          const name = context.context.createAuthCookie("two_factor").name;
          const signed = await context.getSignedCookie(name, context.context.secret);
          if (signed) userId = (await context.context.internalAdapter.findVerificationValue(signed))?.value;
        }
        if (!userId && context.path === "/reset-password" && typeof context.body?.token === "string") {
          userId = (await context.context.internalAdapter.findVerificationValue(`reset-password:${context.body.token}`))?.value;
        }
        if (!userId && context.path === "/passkey/verify-authentication" && typeof context.body?.response?.id === "string") {
          const credential = await context.context.adapter.findOne<{ userId: string }>({ model: "passkey", where: [{ field: "credentialID", value: context.body.response.id }] });
          userId = credential?.userId;
        }
        identity = userId ? { email: `user:${userId}` } : undefined;
      }
      if (!await throttle(context.path, identity)) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Too many attempts. Please try again later.",
        }, { "Retry-After": String(ACCOUNT_THROTTLE_WINDOW_SECONDS) });
      }
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError("SERVICE_UNAVAILABLE", { message: "Sign-in is temporarily unavailable. Please try again later." });
    }
  });
}
