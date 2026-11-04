# Anniversary promotion — current rules (2026-11-04)

During the enabled campaign, every website custom-product order receives 20% off eligible merchandise and customisation. Guests and signed-in customers qualify regardless of previous, unpaid, cancelled or test orders. There is no per-account order limit.

Staff still verify a previous order before generating a returning-customer voucher. The HMAC code remains bound to its registered account; the customer must sign into that account. Each code can be used on one order during the campaign. Creating an order reserves it atomically; payment retries on that same order are allowed, but a different order cannot reuse it, including after failed/cancelled/refunded payment. It applies an extra 20% to the reduced eligible price: $100 → $80 → $64 (36% total). Existing unused codes remain valid; previously reserved or used codes remain unavailable. Regenerating a code returns the same code and does not reset use. Codes are not public or transferable.

Shipping and urgent service are excluded. Supplies remains publicly dormant and is outside custom-product promotion pricing. Configure, cart and checkout use the existing market quote calculation; base browser cart prices are not rewritten, preventing duplicate discounts.

The master campaign switch still disables NEW discounts, voucher issuance/redemption and promotional displays. The order transaction checks it for both guests and account holders. Submitted-order retries keep their stored amounts; no historical order prices change. Standard checkout idempotency, payment capture, paid-only production admission and access controls are unchanged.

Legacy technical names (`firstOrderDiscount`, `first-order-20-v1`, `first-order-offer.ts`) remain for compatibility with saved checkout and order snapshots. Their current base-offer eligibility is campaign state only. Base 20% pricing has no history restriction; returning-customer voucher usage is checked and locked separately using existing returning-discount order snapshots. No database migration, environment change or payment-provider setting is required.
