"use client";

import { createContext, Fragment, useContext, useEffect, useRef, useState } from "react";

import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import {
  clearIdentityCheckoutState,
  setActiveCustomerId,
} from "@/domain/cart/browser-cart-scope";
import { LEGACY_CART_STORAGE_KEY } from "@/domain/cart/types";
import { clearAttribution, handoffGuestAttribution } from "@/domain/analytics/attribution";
import { LEGACY_PAYMENT_INTENT_STORAGE_KEY } from "./payment-recovery-intent";
import { LEGACY_PENDING_CHECKOUT_STORAGE_KEY } from "./pending-checkout";
import { AttributionCapture } from "./attribution-capture";

const LEGACY_SESSION_KEYS = [
  LEGACY_PAYMENT_INTENT_STORAGE_KEY,
  "rnr-checkout-draft-v1",
  "rnr-checkout-payment-intent-cart-v1",
  "rnr-checkout-order-idempotency-v1",
  "rnr-checkout-pending-placement-v1",
] as const;

type CommerceIdentityContextValue = Readonly<{
  customerId: string | null;
  activateUser: (customerId: string) => void;
  signOutToGuest: () => void;
}>;

const fallbackIdentity: CommerceIdentityContextValue = {
  customerId: null,
  activateUser(customerId) {
    setActiveCustomerId(customerId);
    notifyCartChanged();
  },
  signOutToGuest() {
    setActiveCustomerId(null);
    notifyCartChanged();
  },
};

const CommerceIdentityContext = createContext<CommerceIdentityContextValue>(fallbackIdentity);

export function CommerceIdentityProvider({
  children,
  initialCustomerId,
}: Readonly<{ children: React.ReactNode; initialCustomerId: string | null }>) {
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const customerIdRef = useRef(initialCustomerId);
  setActiveCustomerId(customerId);

  useEffect(() => {
    if (customerIdRef.current !== null) {
      handoffGuestAttribution(window.sessionStorage, customerIdRef.current);
    }
    window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_PENDING_CHECKOUT_STORAGE_KEY);
    for (const storageKey of LEGACY_SESSION_KEYS) {
      window.sessionStorage.removeItem(storageKey);
    }
    return () => setActiveCustomerId(null);
  }, []);

  useEffect(() => {
    const previousCustomerId = customerIdRef.current;
    if (previousCustomerId === initialCustomerId) return;
    if (previousCustomerId === null && initialCustomerId !== null) {
      handoffGuestAttribution(window.sessionStorage, initialCustomerId);
    }
    if (previousCustomerId !== null) {
      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        previousCustomerId,
      );
      clearAttribution(window.sessionStorage, previousCustomerId);
    }
    customerIdRef.current = initialCustomerId;
    setActiveCustomerId(initialCustomerId);
    setCustomerId(initialCustomerId);
    notifyCartChanged();
  }, [initialCustomerId]);

  function switchIdentity(nextCustomerId: string | null) {
    if (customerIdRef.current === null && nextCustomerId !== null) {
      handoffGuestAttribution(window.sessionStorage, nextCustomerId);
    }
    customerIdRef.current = nextCustomerId;
    setActiveCustomerId(nextCustomerId);
    setCustomerId(nextCustomerId);
    notifyCartChanged();
  }

  const value: CommerceIdentityContextValue = {
    customerId,
    activateUser(nextCustomerId) {
      const stableId = nextCustomerId.trim();
      if (!stableId) throw new Error("Authenticated customer ID is required");
      switchIdentity(stableId);
    },
    signOutToGuest() {
      if (customerId !== null) {
        clearIdentityCheckoutState(window.localStorage, window.sessionStorage, customerId);
        clearAttribution(window.sessionStorage, customerId);
      }
      switchIdentity(null);
    },
  };

  return (
    <CommerceIdentityContext.Provider value={value}>
      <AttributionCapture customerId={customerId} />
      <Fragment key={customerId ?? "guest"}>
        {children}
      </Fragment>
    </CommerceIdentityContext.Provider>
  );
}

export function useCommerceIdentity() {
  return useContext(CommerceIdentityContext);
}
