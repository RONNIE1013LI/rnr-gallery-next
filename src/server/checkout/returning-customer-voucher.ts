import { createHmac, timingSafeEqual } from "node:crypto";

const campaign = "returning-customer-thank-you:v1";
const codePattern = /^THANKYOU-[A-F0-9]{32}$/;

export function createReturningCustomerVoucher(customerId: string, secret: string): string {
  if (!customerId.trim() || secret.length < 32) throw new Error("Returning customer voucher is unavailable");
  const signature = createHmac("sha256", secret).update(`${campaign}:${customerId}`).digest("hex").slice(0, 32).toUpperCase();
  return `THANKYOU-${signature}`;
}

export function verifyReturningCustomerVoucher(code: string, customerId: string, secret: string): boolean {
  if (!customerId.trim() || secret.length < 32 || !codePattern.test(code)) return false;
  return timingSafeEqual(Buffer.from(code), Buffer.from(createReturningCustomerVoucher(customerId, secret)));
}
