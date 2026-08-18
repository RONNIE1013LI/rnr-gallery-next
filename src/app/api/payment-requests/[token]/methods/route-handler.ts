import { digestPaymentRequestToken } from "@/server/payment-requests/token";
import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import type { PublicPaymentMethod } from "@/server/payments/payment-service";
import { unavailablePaymentRequest } from "../route-handler";

export const runtime = "nodejs";
const privateNoStore = { "Cache-Control": "private, no-store, max-age=0" };
type Context = Readonly<{ params: Promise<{ token: string }> }>;
type Dependencies = Readonly<{
  methods: (token: string) => Promise<readonly PublicPaymentMethod[]>;
}>;

export function createPaymentRequestMethodsRoute(dependencies?: Dependencies) {
  return {
    async GET(_request: Request, context: Context) {
      try {
        const { token } = await context.params;
        const methods = dependencies
          ? await dependencies.methods(token)
          : await getPublicPaymentRequestRuntime().payments.availableMethodsForPaymentRequest(
              token,
              digestPaymentRequestToken(token),
            );
        return Response.json({ methods }, { headers: privateNoStore });
      } catch {
        return unavailablePaymentRequest();
      }
    },
  };
}

const route = createPaymentRequestMethodsRoute();
export const GET = route.GET;
