# Pricing Rules

These values are an audited snapshot of Messenger-derived knowledge, not a future catalog authority. A website assistant should read current product prices, GST, discounts, and availability from the website database.

`REALTIME_REQUIRED`: every price, GST treatment, fee, promotion, package inclusion, product availability, and calculated order total in this file must be checked against the current catalog/configuration before a customer-facing answer. `CONFIRMED` values in `policy-source-map.md` are confirmed historical rules, not permanent prices.

## GST Convention

- Normal photo print canvas base prices: exclusive of GST.
- Custom digital painting canvas: canvas base + person/pet fee, then add 15% GST.
- Digital oil painting banner: banner base + people/faces fee, then add 15% GST.
- Roll-up banner and custom themed wall-banner prices are stored inclusive of GST.
- Customer replies must state whether GST is included.

## Normal Photo Print Canvas

| Size | Base price | GST status |
| --- | ---: | --- |
| A4 | $65 | Plus GST |
| A3 | $78 | Plus GST |
| A2 | $98 | Plus GST |
| A1 | $148 | Plus GST |
| A0 | $280 | Plus GST |

## Custom Digital Painting Canvas

Formula:

`(canvas base price + person/pet price + approved add-ons) x 1.15`

The canvas bases currently reuse the normal photo print base table. This relationship needs business confirmation before becoming authoritative.

### Person/Pet Drawing Price

| Count | Price before GST |
| ---: | ---: |
| 1 | $40 |
| 2 | $60 |
| 3 | $85 |
| 4 | $110 |
| 5 | $130 |
| 6+ | $25 each |

The current code interprets 6+ as `count x $25`. Confirm whether this means every person at $25 or $25 for each person after the first five.

### Canvas Add-ons

- Text: currently free.
- Halo: currently free.
- Angel wings: currently free.
- Holding-baby drawing example: $30.
- Simple object removal/photo cleanup: may be included; complex work requires confirmation.

Known consistent examples:

- A0 + 2 people: `(280 + 60) x 1.15 = $391 incl GST`.
- A0 + 4 people: `(280 + 110) x 1.15 = $448.50 incl GST`.

Known conflict:

- “A1 custom design canvas: $178.25 incl GST” does not match the documented base-plus-person formula and must not be used until verified.

## Roll-up Banner

| Item | Current snapshot |
| --- | --- |
| Size | 85x200cm |
| Package price | $264.50 incl GST |
| Included photos | Up to 5 |
| Extra photo | $5 each |
| Included background removal | 1 |
| Additional background removal | $20 each |
| Included hardware | Stand, carry bag, pegs, box |

Delivery is separate unless a valid free-delivery rule applies.

## Custom Themed Wall Banner

| Customer-facing size | Current price |
| --- | ---: |
| 160x80cm | $189.75 incl GST |
| 200x100cm | $212.75 incl GST |
| 300x150cm | $379.50 incl GST |

Package rules:

- Custom design and eyelets included.
- Up to five photos included.
- Extra photo: $5 each.
- One main-photo background removal included.
- Additional background removal: $20 each.

## Digital Oil Painting Banner

Formula:

`(banner base price + people/faces price) x 1.15`

| Internal size | Base price before GST |
| --- | ---: |
| 80x160cm | $120 |
| 100x200cm | $150 |
| 150x300cm | $295 |

People/faces use the same table as digital painting canvas.

## Revision and Redrawing Fees

- Up to two revisions are described as free before printing.
- Further revision fee: $30, but the fee unit is not defined.
- Replacing/changing a photo after painting starts: $25 per person.

## Urgent Fee

- Orders required within two days: extra $50.
- The fee does not by itself guarantee completion or delivery; capacity and pickup/delivery must be confirmed.

## Deposit

- Half deposit is required before design/painting starts.
- Exact deposit amount must be calculated from the current order total.
- Rounding policy is not defined.

## Price Answering Policy

- Ask product, size, and people/pet/photo count before calculating a custom quote.
- Never use example balances or order totals as catalog prices.
- Check currency explicitly. Existing amounts are treated as NZD snapshots unless a live catalog/order record says otherwise; do not present them as AUD.
- Never infer a discount, special-customer price, price match, promotion, or compensation from a historical conversation.
- Do not reuse a historical exception as a standard product price.
- For the future website assistant, query product catalog, add-ons, GST, discounts, and customer/order state in real time.
