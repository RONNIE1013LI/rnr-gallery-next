import { normalizeAddress } from "@/domain/address/schema";
import {
  defaultProductRegistry,
  getRegistryProductByKey,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { parseCheckoutCartInput } from "@/domain/checkout/input-schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import type { DeliveryPreference } from "@/domain/configuration/types";
import { marketForCountry } from "@/domain/markets/market";
import type { createShippingService } from "@/server/shipping/shipping-service";
import {
  assertOwnedUploadReferences,
  type CheckoutStateRepository,
} from "./checkout-repository";

type ShippingService = ReturnType<typeof createShippingService>;
type GallerySelectionService = Readonly<{
  resolve: (designId: string | undefined, productSlug: string) => Promise<{
    id: string;
    title: string;
    contentHash: string;
    productSlug: string;
    imageUrl: string;
  } | null>;
}>;
type ProductRegistryService = Readonly<{
  current: () => Promise<Readonly<{
    revision: number;
    registry: ProductRegistryDocument;
  }>>;
}>;

export type UpdateCheckoutSessionInput = Readonly<{
  cart: unknown;
  billingAddress: unknown;
  useDifferentDeliveryAddress?: boolean;
  deliveryAddress?: unknown;
  deliveryMethod: DeliveryPreference;
}>;

export class InvalidCheckoutStateError extends Error {
  constructor(message = "The checkout session is incomplete or has changed") {
    super(message);
    this.name = "InvalidCheckoutStateError";
  }
}

export function createCheckoutService({
  repository,
  shippingService,
  gallerySelectionService,
  productRegistryService,
  now = () => new Date(),
}: {
  repository: CheckoutStateRepository;
  shippingService: ShippingService;
  gallerySelectionService?: GallerySelectionService;
  productRegistryService?: ProductRegistryService;
  now?: () => Date;
}) {
  return {
    async updateSession(sessionId: string, input: UpdateCheckoutSessionInput) {
      if (input.deliveryMethod !== "pickup" && input.deliveryMethod !== "post") {
        throw new InvalidCheckoutStateError("Choose Pickup or Post");
      }
      const billingAddress = normalizeAddress(input.billingAddress);
      const deliveryAddress = input.useDifferentDeliveryAddress === true
        ? normalizeAddress(input.deliveryAddress)
        : billingAddress;
      const market = marketForCountry(deliveryAddress.country);
      if (market === "AU" && input.deliveryMethod === "pickup") {
        throw new InvalidCheckoutStateError("Pickup is only available in New Zealand");
      }
      const canonicalCart = parseCheckoutCartInput(input.cart);
      const registryState = productRegistryService
        ? await productRegistryService.current()
        : { revision: 0, registry: defaultProductRegistry };
      const { registry } = registryState;
      const galleryDesigns = new Map();
      await Promise.all(canonicalCart.items.map(async (item) => {
        if (!item.galleryDesignId || !gallerySelectionService) return;
        const product = getRegistryProductByKey(registry, item.productKey);
        if (!product) return;
        const selection = await gallerySelectionService.resolve(
          item.galleryDesignId,
          product.slug,
        );
        if (selection) galleryDesigns.set(item.galleryDesignId, selection);
      }));
      const cartSnapshot = repriceCart(canonicalCart, {
        now: now(),
        galleryDesigns,
        registry,
        market,
        registryRevision: registryState.revision,
      });
      await assertOwnedUploadReferences(
        repository,
        sessionId,
        cartSnapshot.items.flatMap((item) => [...item.uploadReferences]),
      );

      const state = await repository.saveCheckoutState(sessionId, {
        cartDigest: cartSnapshot.cartDigest,
        cartSnapshot,
        billingAddress,
        deliveryAddress,
        deliveryMethod: input.deliveryMethod,
      });
      if (!state) throw new InvalidCheckoutStateError();
      return state;
    },

    async quoteShipping(sessionId: string) {
      const state = await repository.getCheckoutState(sessionId);
      if (
        !state ||
        state.completedAt ||
        !state.cartSnapshot ||
        !state.cartDigest ||
        !state.deliveryAddress ||
        !state.deliveryMethod
      ) {
        throw new InvalidCheckoutStateError();
      }

      if (state.deliveryMethod === "pickup") {
        const cleared = await repository.clearSelectedShippingQuote(
          sessionId,
          state.version,
        );
        if (!cleared) throw new InvalidCheckoutStateError();
        return Object.freeze({
          selectedQuoteId: null,
          option: await shippingService.pickup(),
        });
      }

      const registryState = productRegistryService
        ? await productRegistryService.current()
        : { revision: 0, registry: defaultProductRegistry };
      const snapshotRevision = state.cartSnapshot.priceBookRevision ?? 0;
      const snapshotMarket = state.cartSnapshot.market ?? "NZ";
      if (registryState.revision !== snapshotRevision) {
        throw new InvalidCheckoutStateError("Pricing changed. Review checkout again.");
      }
      const quoted = await shippingService.quotePost(
        state.cartSnapshot,
        state.deliveryAddress,
        registryState.registry.markets[snapshotMarket],
      );
      const persisted = await repository.persistAndSelectShippingQuote({
        sessionId,
        expectedVersion: state.version,
        requestDigest: quoted.requestDigest,
        quote: quoted.quote,
      });
      if (!persisted) throw new InvalidCheckoutStateError();
      return Object.freeze({
        selectedQuoteId: persisted.id,
        option: quoted.option,
      });
    },
  };
}
