import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateNoStore = { "Cache-Control": "private, no-store, max-age=0" };
type Context = Readonly<{ params: Promise<{ token: string }> }>;
type Dependencies = Readonly<{
  publicByToken: (token: string) => Promise<PublicPaymentRequestDTO | null>;
}>;

export function unavailablePaymentRequest() {
  return Response.json({ error: "Payment request is unavailable" }, {
    status: 404,
    headers: privateNoStore,
  });
}

export function createPublicPaymentRequestRoute(dependencies?: Dependencies) {
  return {
    async GET(_request: Request, context: Context) {
      const deps = dependencies ?? { publicByToken: getPublicPaymentRequestRuntime().requests.publicByToken };
      try {
        const { token } = await context.params;
        const request = await deps.publicByToken(token);
        return request
          ? Response.json({ request }, { headers: privateNoStore })
          : unavailablePaymentRequest();
      } catch {
        return unavailablePaymentRequest();
      }
    },
  };
}

const route = createPublicPaymentRequestRoute();
export const GET = route.GET;
