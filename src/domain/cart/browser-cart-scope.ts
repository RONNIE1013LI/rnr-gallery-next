const PREFIX = "rnr:commerce:v1";

let activeCustomerId: string | null = null;

function namespace(customerId: string | null) {
  return customerId === null
    ? "guest"
    : `user:${encodeURIComponent(customerId)}`;
}

function key(customerId: string | null, suffix: string) {
  return `${PREFIX}:${namespace(customerId)}:${suffix}`;
}

export function getCartStorageKey(customerId: string | null) {
  return key(customerId, "cart");
}

export function getPendingCheckoutStorageKey(customerId: string | null) {
  return key(customerId, "checkout:pending");
}

export function getPaymentIntentStorageKey(customerId: string | null) {
  return key(customerId, "checkout:payment-intent");
}

export function getCheckoutDraftStorageKey(customerId: string | null) {
  return key(customerId, "checkout:draft");
}

export function getCheckoutIntentCartBackupKey(customerId: string | null) {
  return key(customerId, "checkout:intent-cart-backup");
}

export function getActiveCustomerId() {
  return activeCustomerId;
}

export function setActiveCustomerId(customerId: string | null) {
  activeCustomerId = customerId;
}

export function getActiveCartStorageKey() {
  return getCartStorageKey(activeCustomerId);
}

export function getActivePendingCheckoutStorageKey() {
  return getPendingCheckoutStorageKey(activeCustomerId);
}

export function getActivePaymentIntentStorageKey() {
  return getPaymentIntentStorageKey(activeCustomerId);
}

export function getActiveCheckoutDraftStorageKey() {
  return getCheckoutDraftStorageKey(activeCustomerId);
}

export function getActiveCheckoutIntentCartBackupKey() {
  return getCheckoutIntentCartBackupKey(activeCustomerId);
}

export function clearIdentityCheckoutState(
  localStorage: Pick<Storage, "removeItem">,
  sessionStorage: Pick<Storage, "removeItem">,
  customerId: string | null,
) {
  localStorage.removeItem(getPendingCheckoutStorageKey(customerId));
  sessionStorage.removeItem(getPaymentIntentStorageKey(customerId));
  sessionStorage.removeItem(getCheckoutDraftStorageKey(customerId));
  sessionStorage.removeItem(getCheckoutIntentCartBackupKey(customerId));
}
