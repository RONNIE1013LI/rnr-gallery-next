export const THANK_YOU_OFFER_CONTENT_KEY = "promotions.thank_you.enabled";

// Compatibility default for an installation with no persisted campaign setting.
export const THANK_YOU_OFFER_ENABLED = true;

export const RETURNING_CUSTOMER_VOUCHER_KEY = "returning-customer-20-v1";
export const LEGACY_RETURNING_CUSTOMER_VOUCHER_KEY = "returning-customer-36-v1";
export const RETURNING_CUSTOMER_VOUCHER_PERCENTAGE = 20;

// Current orders use numeric references; older online orders use RNR references.
export const VOUCHER_ORDER_REFERENCE_PATTERN = /^(?:[0-9]{5,}|RNR-[0-9]{4}-[A-Z0-9]+)$/;
