import { createHmac } from "node:crypto";

type Options = { secret: string; consume: (key: string, seconds: number) => Promise<number> };
const limits: Readonly<Record<string, number>> = {
  "/sign-in/email": 10,
  "/sign-up/email": 5,
  "/request-password-reset": 3,
  "/two-factor/verify-totp": 10,
  "/two-factor/verify-backup-code": 10,
  "/two-factor/enable": 5,
  "/passkey/verify-authentication": 10,
  "/passkey/verify-registration": 5,
  "/passkey/generate-register-options": 10,
  "/passkey/generate-authenticate-options": 20,
  "/reset-password": 5,

};

export const ACCOUNT_THROTTLE_WINDOW_SECONDS = 15 * 60;
export const CONSUME_ACCOUNT_ATTEMPT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

export function createAccountThrottle(options: Options) {
  if (options.secret.length < 32) throw new Error("Authentication throttle configuration is unavailable");
  return async (path: string, body: unknown): Promise<boolean> => {
    const limit = limits[path];
    if (!limit || !body || typeof body !== "object" || !("email" in body) || typeof body.email !== "string") return true;
    // This dimension is independent of IP. Existing Better Auth IP/endpoint
    // limits remain in place, including for malformed or missing identifiers.
    const email = body.email.trim().toLowerCase();
    const digest = createHmac("sha256", options.secret)
      .update(`rnr:auth-account:v1\0${path}\0${email}`).digest("hex");
    const count = await options.consume(`rnr:auth-account:v1:${digest}`, ACCOUNT_THROTTLE_WINDOW_SECONDS);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Authentication throttle is unavailable");
    return count <= limit;
  };
}
