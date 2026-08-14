import { cookies } from "next/headers";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { CHECKOUT_SESSION_COOKIE_NAME } from "@/server/checkout/session-cookie";
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
  return resolveCustomerProofAccess({
    orderNumber: input.orderNumber,
    fileId: input.fileId,
    expires: integer(input.expires),
    signature: input.signature,
    userId: session?.user.id ?? null,
    checkoutToken: cookieStore.get(CHECKOUT_SESSION_COOKIE_NAME)?.value ?? null,
  }, process.env.BETTER_AUTH_SECRET ?? "");
}
