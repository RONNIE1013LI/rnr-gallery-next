# Customer Email Signature Design

## Goal

Add one centrally managed R&R Gallery signature with the official logo to every customer-facing email while keeping internal administrator notifications unchanged.

## Scope

The shared signature applies to newly sent:

- Customer payment-confirmed emails
- Customer payment-failed emails
- Customer order-shipped emails
- Customer design-proof emails
- Customer password-reset emails

The internal `admin_order_received` notification does not use this customer-service signature.

## Default Signature

```text
Kind regards,
Customer Service Team

Customer Service | R&R Gallery Ltd. NZ
customerservice@rnrgallery.com
rrgallery.co.nz
11 Para Close, Fairview Heights, Auckland 0632.
```

The HTML version adds the existing official R&R Gallery logo and renders the email and website as links. The plain-text version retains all contact details without depending on images.

## Admin Editing

Add a `Customer email signature` section to `Admin > Email templates`. Reuse the existing `content_entries` draft/publish workflow, `manage_content` and `publish_content` permissions, and audit records.

Editable plain-text fields:

- Sign-off
- Team name
- Company line
- Customer-service email
- Website label
- Street address

Only published values affect new messages. Drafts remain Admin-only. Missing or unreadable published values use the code defaults above.

## Logo and Links

- Use the existing official asset `/media/brand/rr-gallery-logo-2026.webp`.
- Convert it to an absolute HTTPS URL from the trusted site origin supplied by the server.
- Render it at an email-safe fixed display width with proportional height and `alt="R&R Gallery"`.
- Do not accept an arbitrary image URL, HTML, CSS, tracking pixel, attachment, or data URI from Admin.
- Generate the email link from the validated customer-service email field.
- Generate the website link from the trusted site origin; the editable website field controls visible text only.
- When an email client blocks remote images, the complete text signature remains visible.

## Rendering Architecture

Create one pure server-side signature renderer that returns both HTML and plain-text fragments from published signature values plus a trusted site origin. All five customer email paths append these fragments after their existing message and action link.

Order notifications continue using their existing signed order URL and idempotency key. Proof notifications continue using their existing signed proof URL. Password-reset notifications continue using their existing reset URL and token-derived idempotency key. The signature renderer cannot change any of those values.

## Security and Privacy

- Continue rejecting angle brackets, scripts, arbitrary HTML, malformed template variables, and administrator-supplied URLs.
- Validate the signature email as an email address.
- The trusted site origin, not editable text, controls the website and logo destinations.
- Do not add customer data, order data, tokens, or analytics identifiers to the signature.
- Escape all editable and customer-derived values before HTML rendering.

## Testing

Add automated coverage for:

- Default text and HTML signature output
- Published field overrides and field-by-field fallback
- Fixed official logo URL and accessible alt text
- Trusted website destination despite edited display text
- Rejection of invalid email, URLs, HTML, and unknown variables
- Signature present in payment-confirmed, payment-failed, shipped, proof, and password-reset emails
- Signature absent from `admin_order_received`
- Existing recipients, amounts, signed URLs, expiry, idempotency, retries, and payment behavior unchanged
- Draft values not affecting outgoing emails

Run focused tests first, then TypeScript, ESLint, the complete test suite with the dedicated test database, and a production build.

## Non-goals

- No rich-text or arbitrary HTML editor
- No editable sender or recipient logic
- No logo upload or external image URL field
- No changes to pricing, payments, orders, authentication, proof authorization, cart state, or historical emails
- No automatic resend of previously delivered email
