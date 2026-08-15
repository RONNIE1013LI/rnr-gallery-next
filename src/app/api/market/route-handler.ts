import { parseMarketCookie, marketCookieHeader } from "@/server/markets/market-cookie";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";

type Dependencies = Readonly<{
  current: ReturnType<typeof getProductRegistryRuntime>["current"];
  trustedOrigin?: string;
}>;

export function createMarketRoute(dependencies?: Dependencies) {
  return {
    async POST(request: Request) {
      try {
        const current = dependencies?.current ?? getProductRegistryRuntime().current;
        assertTrustedMutationRequest(request, dependencies?.trustedOrigin);
        const body = await parseBoundedJson(request) as { market?: unknown; cart?: unknown };
        const market = parseMarketCookie(typeof body.market === "string" ? body.market : null);
        if (!market) {
          return Response.json({ error: "Choose a supported market." }, { status: 422 });
        }
        const { registry, revision } = await current();
        if (!registry.markets[market].enabled) {
          return Response.json({ error: "This market is not available yet." }, { status: 409 });
        }
        const cart = body.cart === undefined
          ? undefined
          : repriceCart(body.cart, { registry, registryRevision: revision, market });
        return Response.json(
          { market, currency: registry.markets[market].currency, ...(cart ? { cart } : {}) },
          {
            headers: {
              "Cache-Control": "no-store",
              "Set-Cookie": marketCookieHeader(market, new URL(request.url).protocol === "https:"),
            },
          },
        );
      } catch (error) {
        if (error instanceof MutationRequestError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof InvalidCheckoutCartError) {
          return Response.json({ error: error.message }, { status: 409 });
        }
        return Response.json({ error: "The market could not be changed." }, { status: 500 });
      }
    },
  };
}

const route = createMarketRoute();
export const POST = route.POST;
