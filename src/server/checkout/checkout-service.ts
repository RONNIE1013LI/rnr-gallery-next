import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { createShippingService } from "@/server/shipping/shipping-service";
import {
  assertOwnedUploadReferences,
  type CheckoutStateRepository,
} from "./checkout-repository";

type ShippingService = ReturnType<typeof createShippingService>;

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
  now = () => new Date(),
}: {
  repository: CheckoutStateRepository;
  shippingService: ShippingService;
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
      const cartSnapshot = repriceCart(input.cart, { now: now() });
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

      const quoted = await shippingService.quotePost(
        state.cartSnapshot,
        state.deliveryAddress,
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
