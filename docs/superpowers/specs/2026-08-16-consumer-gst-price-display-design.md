# Consumer GST Price Display

## Goal

Show the actual GST-inclusive amount customers will pay as the primary price on every consumer-facing page, without changing catalogue pricing, GST calculations, existing orders, or payment-provider amounts.

For example, the Roll-Up Banner remains NZ$230.00 excluding GST, NZ$34.50 GST, and NZ$264.50 including GST. Stripe and Afterpay continue to charge NZ$264.50.

## Design

- Keep the existing catalogue and pricing engine as the authoritative source. Catalogue prices remain stored excluding GST and the pricing engine continues to add 15% GST.
- Use explicit `NZ$` formatting and show the calculated final value as the primary consumer price: `NZ$264.50 incl GST`.
- Remove secondary `excl GST` prices from public product cards, product details, design details, advertising landing pages, and configuration choices so customers are not asked to mentally add tax.
- In configurator, Cart, Checkout, and order summaries, show item prices and totals using GST-inclusive amounts. An excluded-GST subtotal and GST component may remain only as a clearly subordinate tax breakdown where needed for invoices or order transparency.
- Keep structured data and future Merchant Center product data aligned with the same GST-inclusive price shown on the landing page and available at checkout.
- Do not change historical orders, completed payments, Stripe/Afterpay calculations, shipping-provider rate calculations, admin pricing storage, or database price fields.

## Verification

- Add regression tests for public price components and representative product/configuration pages.
- Verify Roll-Up Banner displays NZ$264.50 incl GST and never presents NZ$230.00 as the customer-facing final price.
- Verify Cart, Checkout, order creation, and payment adapters continue to use the unchanged GST-inclusive total.
- Run TypeScript, focused unit tests, production build, and mobile/desktop browser checks at the canonical local site.

