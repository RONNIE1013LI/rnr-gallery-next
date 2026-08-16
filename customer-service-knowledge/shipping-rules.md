# Shipping Rules

`REALTIME_REQUIRED`: shipping price, free-shipping eligibility, destination zone, remote-area status, courier service, dispatch date, ETA, tracking, rerouting, and production capacity must come from current systems. Historical timings are guidance only.

## General

- Production time and delivery time are separate.
- Design and printing usually take around five working days after all photos, details, and deposit are received.
- Delivery timing depends on dispatch date, destination, courier route, and remote-area status.
- Do not guarantee an arrival date unless the courier/order system confirms it.
- A courier estimate is not a business guarantee. Urgent-order and delivery guarantees are `HIGH RISK` and always require human approval.
- For a quote, collect recipient name, full address/postcode, contact number, and tracking email through a secure order flow.

## New Zealand

- Current rule: NZ North Island orders over $299 include free delivery.
- This is a confirmed historical rule but remains `REALTIME_REQUIRED`; the current threshold and eligibility calculation must be checked.
- The current code uses a strict amount greater than $299.
- For all other NZ orders, request the full address before quoting.
- South Island, rural, oversized, local Auckland, and product-specific rates are not documented.

## Australia

- Shipping to Australia is supported.
- DHL delivery to major Australian cities is described as 1-2 days after dispatch.
- Standard delivery is described as about one week.
- Remote areas may take longer.
- Tracking is sent by the courier after pickup.
- Rates, supported postcodes, remote-area rules, and service selection are missing.
- Existing monetary values are NZD snapshots unless the live shipping/order system explicitly returns another currency. Never assume an Australian destination means the quote is in AUD.

## Required-Date Enquiries

- Treat the requested date as a target, not a promise.
- Ask for product, order readiness, destination postcode, and required date.
- Date-specific overseas and urgent replies require human/operations confirmation.
- Do not reuse fixed “Saturday,” “Porirua,” or “28 August” wording from historical examples.

## Address Changes

- Check whether the parcel is booked or dispatched before promising an address change.
- Obtain the new address through a secure flow.
- Confirm any rerouting fee and changed ETA from the courier/order system.

## Tracking and Delivery Status

- Tracking number, carrier, pickup time, dispatch status, and ETA are order-specific live data.
- Never use the tracking number contained in a historical example.
- If an order is ready but has an unpaid balance, retrieve the actual balance and payment state before discussing shipment.

## Pickup

- Pickup is a separate fulfillment method, not shipping.
- Current location/hours are operational configuration and must be verified live.
- Ask customers to message before arrival and provide the current pickup reference from the order system.

## Safe Reply Pattern

For general timing:

> Design and printing usually take around 5 working days after we receive all photos, details and the deposit. Delivery time depends on your location. Please send your suburb/postcode and required date for an estimate.

For a deadline:

> We can check this for you. Please send the product, required date and delivery postcode. Final timing depends on production capacity and the courier, so we will confirm before promising the date.
