import { cookies } from "next/headers";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { getCheckoutSessionCookieName } from "@/server/checkout/session-cookie";
import { resolveCustomerProofAccess } from "./customer-proof-access";

function integer(value: string | null | undefined) {
  if (!value || !/^\d{1,12}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function resolveCustomerProofRequestAccess(input: Readonly<{
  orderNumber: string;
  fileId?: string | null;
  expires?: string | null;
  signature?: string | null;
}>) {
  const [session, cookieStore] = await Promise.all([getOptionalSession(), cookies()]);
  const customerId = session?.user.id ?? null;
  return resolveCustomerProofAccess({
    orderNumber: input.orderNumber,
    fileId: input.fileId,
    expires: integer(input.expires),
    signature: input.signature,
    userId: customerId,
    checkoutToken: cookieStore.get(getCheckoutSessionCookieName(customerId))?.value ?? null,
  }, process.env.BETTER_AUTH_SECRET ?? "");
}
