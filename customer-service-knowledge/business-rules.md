# Business Rules

Rule status and automation authority are defined in `policy-source-map.md`. Any current price, package, availability, production capacity, pickup detail, payment method, balance, or order status is `REALTIME_REQUIRED`.

## Product Formats

### Custom digital painting canvas

- Combines people and pets from one or more photographs into one artwork.
- Canvas base price, person/pet count, and GST determine the quote.
- Text, halo, and angel wings are currently described as free.
- Canvas does not include a stand.
- Canvas is described as waterproof, but sheltered use is recommended for longer outdoor life.

### Normal photo print canvas

- Uses the submitted photograph without the digital-painting person/pet fee.
- Prices are stored as base prices exclusive of GST.
- The distinction from custom digital painting must be confirmed before quoting.

### Roll-up banner

- Current size: 85x200cm.
- Freestanding format with roll-up stand, carry bag, pegs, and box.
- Includes custom design, up to five photos, and one free background removal.

### Custom themed wall banner

- Hanging/landscape format with eyelets, ready to hang.
- Customer-facing sizes use width x height: 160x80cm, 200x100cm, and 300x150cm.
- Includes custom design, up to five photos, and one free main-photo background removal.

### Digital oil painting banner

- Combines a banner-size base price with a people/faces drawing fee and GST.
- Distinct from a themed wall banner even when physical sizes overlap.

## AI Product-Difference Boundary

- Ask whether the customer needs a wall-mounted or freestanding display.
- Do not state package contents, included hardware, or a product recommendation as fact unless a separate `CONFIRMED` rule permits it.
- When confirmed facts are insufficient, collect the display requirement and leave the recommendation for human review.

## Order Intake

Collect only the information needed for the selected product:

- Product format and size.
- Occasion and required date.
- Original photos.
- Total people/pets/faces.
- Main photo.
- Top and bottom text.
- Theme/background and colour preferences.
- Font preference when relevant.
- Portrait or landscape orientation when relevant.
- Delivery suburb/postcode or pickup preference.

Ask one clear qualifying question at a time when the request is unclear.

## Design Start and Payment

- Do not begin custom design before an order is placed.
- Work begins after half deposit is received.
- Split/weekly payments are accepted in the current Messenger rules.
- Remaining balance may be paid when the order is ready to post or collect.
- Customers are asked to use their name as the payment reference and send payment confirmation.
- Card and Afterpay are the supported online methods, but current operational availability must be read from live payment configuration.
- Bank account details exist in runtime code and must not be copied into a public AI knowledge base.
- Payment disputes, chargebacks, failed payments, disputed balances, refunds, discounts, and compensation are `HIGH RISK` and always require human handling.

## Pickup

Current Messenger snapshot:

- Pickup location is in Fairview Heights, Albany, North Shore, Auckland.
- Stored pickup hours are Monday-Friday, 8:00 AM-8:00 PM.
- Customer should message at least two hours before pickup.
- Busy-season template asks for one day of notice.
- Order and pickup reference numbers should be supplied when available.
- Outstanding balance must be confirmed from the order system, not from a template.

Address, hours, directions, availability, reference numbers, and balances are operational data and should be read from configuration/order records.

## Privacy and Sharing

- Ask permission before posting customer artwork, photos, or videos publicly.
- Do not treat a generic “share” message as permission without confirming what will be shared and where.
- Do not place names, phone numbers, addresses, payment screenshots, bank data, order references, or tracking numbers in shared knowledge files.

## Current Runtime Facts

- The Messenger app can draft, manually send, or auto-send replies marked low risk.
- Price-list images may be attached based on keyword matching.
- Only one canvas price-list image is currently present; other referenced image files are missing.
