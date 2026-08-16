# Admin Email Templates Design

## Goal

Allow administrators to safely edit and publish the wording of every current automated order email without changing recipients, order values, payment state, secure order links, or delivery behavior.

## Scope

Add `Admin > Settings > Email templates` for these four notification kinds:

- Customer payment confirmed
- Customer payment failed
- Admin new paid order
- Customer order shipped

Each template supports editable subject text, body text, and action-button label. The page provides a preview, uses the existing draft/publish workflow, and records changes through the existing admin audit system.

## Storage and Publishing

- Reuse the existing `content_entries` storage and content service instead of adding a new email-template table.
- Store each editable template field under a stable, namespaced content key.
- Draft values are visible only in Admin and never affect outgoing mail.
- Only published values are used for new email deliveries.
- Missing or invalid published fields fall back to the current code defaults so notification delivery is not blocked.
- Existing queued or previously sent emails are not rewritten or resent by editing a template.

## Safe Variables

Templates may use only these fixed variables where applicable:

- `{{customer_name}}`
- `{{order_number}}`
- `{{amount}}`
- `{{tracking_number}}`
- `{{tracking_carrier}}`

Unknown variables are rejected during validation. Template values are plain text; administrators cannot enter arbitrary HTML, scripts, URLs, or template logic. Variable values are HTML-escaped before insertion into HTML email output.

## Protected System Behaviour

The following remain code-controlled and cannot be changed in Admin:

- Recipient and sender addresses
- Notification event kind and idempotency key
- Order number source, currency, amount, payment status, and tracking source
- Signed order-access URL, signature, and expiration
- Retry scheduling, stale-failure suppression, queue status, and provider delivery
- Which event triggers each email

The server continues to generate the HTML shell and safe action URL. The editor changes wording only.

## Permissions and Audit

- Access uses the existing `manage_content` permission boundary.
- Staff with that permission may save drafts, matching the current content workflow.
- Only administrators may publish templates that affect outgoing email.
- Draft and publish actions use the existing admin audit-log conventions without logging customer data or rendered order details.

## Admin Experience

- Add a settings navigation entry named `Email templates`.
- Show one clearly labelled editor section per notification kind.
- Show available variables beside the relevant fields.
- Preview with fixed fictional sample values, never real customer or order data.
- Provide clear validation errors near the affected field.
- Continue showing the built-in default when no published override exists.

## Rendering Flow

1. A notification is queued from the existing payment or fulfilment event.
2. At delivery time, the service loads the published fields for that notification kind.
3. Missing fields use the built-in default text.
4. Allowed variables are substituted using the current order delivery data.
5. The existing server renderer produces escaped text and HTML messages with the system-generated action URL.
6. The existing email provider sends the message with its existing idempotency key.

## Testing

Add automated coverage for:

- All four template definitions and default fallbacks
- Draft values not affecting outgoing email
- Published values affecting only the matching notification kind
- Allowed-variable substitution
- Rejection of unknown variables and arbitrary HTML/script input
- HTML escaping of substituted values
- Permission checks for viewing, saving, and publishing
- Preview output using fictional data only
- Protected signed order links remaining system-generated
- Existing notification retries, idempotency, and recipient selection remaining unchanged

Run focused tests after each implementation step, then run TypeScript, lint, the relevant server/component tests, and the production build before deployment.

## Non-goals

- No rich-text or arbitrary HTML editor
- No editable sender/recipient rules
- No new email provider
- No changes to prices, payment processing, order creation, authentication, cart isolation, shipping, or completed orders
- No automatic resend of historical notifications
