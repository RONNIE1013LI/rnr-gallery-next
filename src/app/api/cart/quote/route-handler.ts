import { ZodError, z } from "zod";
import { getRegistryProductByKey } from "@/domain/catalogue/product-registry";
import { parseCheckoutCartInput } from "@/domain/checkout/input-schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { InvalidCheckoutCartError, supplySelectionKey, type GalleryDesignSnapshot, type RepricedCheckoutCart, type SupplyPurchaseSnapshot } from "@/domain/checkout/types";
import { SUPPLIES_PUBLIC_STORE_DORMANT } from "@/domain/supplies/catalogue-policy";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { InvalidReturningVoucherError, resolveCustomerOffer } from "@/server/checkout/first-order-offer";
import { getDatabase } from "@/server/db/client";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { getSupplyPurchaseService } from "@/server/supplies/purchase-runtime";

const quoteInputSchema = z.object({ cart: z.unknown(), market: z.enum(["NZ", "AU"]), voucherCode: z.unknown().optional() });
type QuoteInput = z.infer<typeof quoteInputSchema>;
type Dependencies = Readonly<{
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  quote: (input: QuoteInput, customerId: string | null) => Promise<RepricedCheckoutCart>;
  trustedOrigin?: string;
}>;
const noStore = { "Cache-Control": "no-store" };
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStore }); }

async function quote(input: QuoteInput, customerId: string | null): Promise<RepricedCheckoutCart> {
  const cart = parseCheckoutCartInput(input.cart);
  if (SUPPLIES_PUBLIC_STORE_DORMANT && cart.items.some((item) => item.kind === "supply")) {
    throw new InvalidCheckoutCartError("Supplies are unavailable.");
  }
  const registryState = await getProductRegistryRuntime().current();
  const galleryDesigns = new Map<string, GalleryDesignSnapshot>();
  await Promise.all(cart.items.map(async (item) => {
    if (item.kind === "supply" || !item.galleryDesignId) return;
    const product = getRegistryProductByKey(registryState.registry, item.productKey);
    if (!product) return;
    const selection = await getGalleryRuntime().selectionService.resolve(item.galleryDesignId, product.slug);
    if (selection) galleryDesigns.set(item.galleryDesignId, selection);
  }));
  const supplies = new Map<string, SupplyPurchaseSnapshot>();
  if (cart.items.some((item) => item.kind === "supply")) {
    // An explicit reader skips reservation-expiry writes in the purchase factory.
    const service = getSupplyPurchaseService(getDatabase());
    for (const item of cart.items) {
      if (item.kind !== "supply") continue;
      supplies.set(supplySelectionKey(item.supplyProductId, item.supplyVariantId), await service.resolve(item.supplyProductId, item.supplyVariantId));
    }
  }
  const offers = await resolveCustomerOffer(getDatabase(), customerId, input.voucherCode, process.env.BETTER_AUTH_SECRET ?? "");
  return repriceCart(cart, { ...offers, registry: registryState.registry, registryRevision: registryState.revision, market: input.market, galleryDesigns, supplies });
}

export function createCartQuoteRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps: Dependencies = dependencies ?? { getOptionalSession, quote };
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const input = quoteInputSchema.parse(await parseBoundedJson(request));
      const session = await deps.getOptionalSession(request.headers);
      const cart = await deps.quote(input, session?.user.id ?? null);
      return json({ cart, signedIn: session !== null });
    } catch (error) {
      if (error instanceof MutationRequestError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof SyntaxError) return json({ error: { code: "INVALID_JSON", message: "Request body is invalid" } }, 400);
      if (error instanceof InvalidReturningVoucherError || error instanceof InvalidCheckoutCartError) return json({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
      if (error instanceof ZodError) return json({ error: { code: "VALIDATION_ERROR", message: "The cart or market is invalid. Review your cart and try again." } }, 422);
      return json({ error: { code: "INTERNAL_ERROR", message: "The cart could not be quoted." } }, 500);
    }
  };
}
export const POST = createCartQuoteRoute();
