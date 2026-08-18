import { createHash, randomBytes } from "node:crypto";

const paymentTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function digestPaymentRequestToken(rawToken: string): string {
  if (!paymentTokenPattern.test(rawToken)) throw new Error("Invalid payment token");
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generatePaymentRequestToken(): Readonly<{
  rawToken: string;
  digest: string;
}> {
  const rawToken = randomBytes(32).toString("base64url");
  return Object.freeze({
    rawToken,
    digest: digestPaymentRequestToken(rawToken),
  });
}
