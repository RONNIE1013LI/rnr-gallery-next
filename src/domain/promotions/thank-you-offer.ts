export const THANK_YOU_OFFER_CONTENT_KEY = "promotions.thank_you.enabled";

// Compatibility default for an installation with no persisted campaign setting.
export const THANK_YOU_OFFER_ENABLED = true;

// Current orders use numeric references; older online orders use RNR references.
export const VOUCHER_ORDER_REFERENCE_PATTERN = /^(?:[0-9]{5,}|RNR-[0-9]{4}-[A-Z0-9]+)$/;
