import { parseMarketCookie, marketCookieHeader } from "@/server/markets/market-cookie";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import {
  preflightMarketSwitch,
  type MarketSwitchUrgentIssue,
} from "@/domain/checkout/market-switch-preflight";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";
import { ZodError } from "zod";

type MarketRouteFailure = Readonly<{
  error: string;
  code:
    | "unsupported_market"
    | "market_unavailable"
    | "urgent_confirmation_required"
    | "invalid_cart"
    | "market_switch_failed";
  issues?: readonly MarketSwitchUrgentIssue[];
}>;

type Dependencies = Readonly<{
  current: ReturnType<typeof getProductRegistryRuntime>["current"];
  trustedOrigin?: string;
}>;

function failureResponse(
  body: MarketRouteFailure,
  status: number,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createMarketRoute(dependencies?: Dependencies) {
  return {
    async POST(request: Request) {
      try {
        const current = dependencies?.current ?? getProductRegistryRuntime().current;
        assertTrustedMutationRequest(request, dependencies?.trustedOrigin);
        const body = await parseBoundedJson(request) as { market?: unknown; cart?: unknown };
        const market = parseMarketCookie(typeof body.market === "string" ? body.market : null);
        if (!market) {
          return failureResponse({
            error: "Choose a supported market.",
            code: "unsupported_market",
          }, 422);
        }
        const { registry, revision } = await current();
        if (!registry.markets[market].enabled) {
          return failureResponse({
            error: "This market is not available yet.",
            code: "market_unavailable",
          }, 409);
        }
        const preflight = body.cart === undefined
          ? null
          : preflightMarketSwitch(body.cart, {
              registry,
              registryRevision: revision,
              market,
            });
        if (preflight?.result === "urgent_confirmation_required") {
          return failureResponse({
            error: "Confirm urgent service or choose another completion date.",
            code: "urgent_confirmation_required",
            issues: preflight.issues,
          }, 409);
        }
        const cart = preflight?.result === "ready" ? preflight.cart : undefined;
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
          return failureResponse({
            error: "The market could not be changed.",
            code: "market_switch_failed",
          }, error.status);
        }
        if (error instanceof InvalidCheckoutCartError || error instanceof ZodError) {
          return failureResponse({
            error: "The cart could not be repriced for this market.",
            code: "invalid_cart",
          }, 409);
        }
        return failureResponse({
          error: "The market could not be changed.",
          code: "market_switch_failed",
        }, 500);
      }
    },
  };
}

const route = createMarketRoute();
export const POST = route.POST;
