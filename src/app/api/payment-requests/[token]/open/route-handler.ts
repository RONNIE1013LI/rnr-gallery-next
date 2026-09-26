import { parseAuthConfig } from "@/server/auth/config";
import { assertTrustedMutationRequest, MutationRequestError } from "@/server/http/mutation-request";
import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
type Context = Readonly<{ params: Promise<{ token: string }> }>;

export function createPaymentRequestOpenRoute(dependencies?: Readonly<{
  origin: string;
  activateByToken(token: string): Promise<PublicPaymentRequestDTO | null>;
}>) {
  return async function POST(request: Request, context: Context) {
    try {
      assertTrustedMutationRequest(request, dependencies?.origin ?? parseAuthConfig().origin);
      const { token } = await context.params;
      const activate = dependencies?.activateByToken
        ?? getPublicPaymentRequestRuntime().requests.activateByToken;
      const opened = await activate(token);
      return opened
        ? Response.json({ request: opened }, { headers })
        : Response.json({ error: "Payment request is unavailable" }, { status: 404, headers });
    } catch (error) {
      return Response.json({ error: error instanceof MutationRequestError ? error.message : "Payment request is unavailable" }, {
        status: error instanceof MutationRequestError ? error.status : 503,
        headers,
      });
    }
  };
}

export const POST = createPaymentRequestOpenRoute();
