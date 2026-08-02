# R&R Next Platform — Product Configuration and Cart Design

## Status

Approved as Phase 2 of the platform design accepted on 2 August 2026. The user
has instructed implementation to continue without per-batch approval while the
existing WordPress system remains unchanged.

## Objective

Turn the Phase 1 discovery site into a working custom-order funnel: each active
product can be configured, quoted from authoritative rules and added to a guest
cart that survives browser refreshes.

## Scope

Phase 2 is delivered in two independently verifiable slices.

### Slice A — configuration and cart

- Source-controlled product configuration schemas for all seven products.
- Size, orientation, people/pets, photo-submission method, wording, notes,
  needed date and delivery preference where applicable.
- Server-compatible quote functions for base, people/pets and GST.
- A guided product configurator with a live order summary.
- Guest cart persistence in versioned browser storage.
- Cart quantity, removal, totals and edit-link metadata.

### Slice B — private source files

- Validated image and PDF selection.
- A server-side private-upload adapter storing development files outside
  `public/`.
- Opaque upload references associated with the guest session and cart item.
- No original customer file URL in public markup or catalogue data.

Checkout, shipping quotes, accounts, payment and order creation remain Phase 3
and Phase 4 responsibilities.

## Architecture

- `src/domain/configuration` owns product schemas and validates user selections.
- `src/domain/cart` owns immutable cart items, quantity and totals.
- Client components own temporary form state only. They call domain functions;
  they never implement prices themselves.
- A versioned cart repository hides local-storage mechanics behind `load`,
  `save` and `clear` methods so a server session can replace it later.
- Product options are snapshots inside each cart item. Later catalogue changes
  do not silently rewrite an existing item.

## Product Rules

- Photo Print Canvas: A4–A0, orientation, exactly one source photo.
- Digital Oil Painting Canvas: A4–A0, orientation, one or more people/pets.
- Custom Themed Canvas: A3–A0, orientation, up to 20 included photos.
- Roll-Up Banner: fixed 85 × 200 cm, up to five included photos.
- Custom Themed Wall Banner: 160 × 80, 200 × 100 or 300 × 150 cm.
- Digital Oil Painting Banner: 160 × 80, 200 × 100 or 300 × 150 cm and one or
  more people/pets.
- Grave Cover: fixed 100 × 200 cm portrait, up to five included photos.
- Delivery preference defaults to Post and also permits Pickup.
- Source photos may be uploaded during configuration or supplied after ordering.

## Cart Model

Each cart item contains an opaque ID, product key/slug/title, selected size,
orientation when applicable, people/pets count when applicable, source-photo
method, wording, notes, needed date, delivery preference, quantity, an immutable
price snapshot and zero or more private upload references.

The cart repository rejects unknown storage versions and malformed records. It
returns an empty cart rather than trusting corrupt browser data.

## UX

- Product detail pages gain one primary “Configure your artwork” action.
- The configurator uses a two-column editorial layout on desktop and one column
  at 820px and below.
- Each logical group has a numbered heading, concise help copy and native form
  controls.
- The summary remains visible beside the form on desktop, shows ex-GST subtotal,
  GST and inclusive total, and never displays `$0.00` for a valid default.
- All controls retain 44px minimum targets and visible keyboard focus.
- Successful add-to-cart feedback links directly to the cart.

## Error Handling and Security

- Invalid configurations return typed domain errors.
- Cart parsing fails closed to an empty cart.
- File type and size are revalidated server-side in Slice B.
- Filenames are display metadata only and never form storage paths.
- Browser-provided prices are ignored by future checkout and order APIs.

## Testing

- Domain vector tests cover every product schema and known pricing totals.
- Component tests cover default selections, people controls and add-to-cart.
- Repository tests cover round-trip persistence, schema-version rejection and
  corrupt JSON.
- Browser checks cover product → configure → cart at 390, 820 and 1440px.

## Success Criteria

- All seven product pages lead to a valid configurator.
- A valid default configuration has a non-zero quote.
- Digital Oil Painting Canvas A4 with one person remains $105 ex GST, $15.75
  GST and $120.75 incl GST.
- Adding an item persists it across refresh and cart totals remain consistent.
- No change is made to `../rnr-wordpress-staging`.
