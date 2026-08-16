# Customer Email Signature Preview Design

## Goal

Add a safe, live preview of the complete customer email signature to the existing Admin email-template page. The preview must let an administrator inspect the current unsaved field values without sending an email or changing any order.

## Scope

- Show one combined preview inside the existing `Customer email signature` group.
- Update the preview immediately when any of the six signature fields changes.
- Include the production logo, sign-off, team name, company line, email, website label and address.
- Keep the existing Save draft and Publish controls unchanged.
- Do not add a test-email action, order-email resend action or new API route.
- Do not change order, payment or notification-delivery logic.

## Implementation Design

`EmailTemplateForm` will own the current editable value for each entry. Each `EmailTemplateEditor` will receive its current value and a change callback instead of keeping an isolated value that the parent cannot see.

For the customer-signature group, the form will collect the six current draft values and pass them through the existing production `renderCustomerEmailSignature` function. The returned, escaped HTML will be displayed in a dedicated preview panel. Reusing the production renderer prevents the preview and delivered-email signature from drifting apart.

The preview will use the trusted R&R Gallery site origin for its logo and website destination. Administrator-entered text remains escaped by the existing renderer; arbitrary HTML and arbitrary link destinations remain unsupported.

The existing per-field sample preview will remain for order-template fields. It will be omitted for signature fields because the new combined preview provides the useful context and avoids repetitive single-line previews.

## Layout

- The combined preview appears directly under the `Customer email signature` heading.
- It is visually separated from editing controls and labelled `Live signature preview`.
- The sign-off and team name remain above the contact block.
- The round Logo appears to the left of the company, email, website and address lines.
- The Logo displays at 72 by 72 pixels from a dedicated 288 by 288 lossless PNG for sharp Retina rendering; the four contact lines use an 18-pixel line height so their total height is also 72 pixels.
- The email HTML uses a presentation table for dependable two-column rendering across email clients.
- Desktop and mobile use the existing Admin design system.
- Mobile uses normal document flow with no sticky or floating behavior.

## Data Flow

1. The page loads draft and published content through the existing Admin content runtime.
2. `EmailTemplateForm` initializes an editable values map from each entry's draft value.
3. Editing a field updates the corresponding value in that map.
4. Signature values are rendered into the combined preview immediately.
5. Save draft and Publish continue to send only the selected field through the existing content mutation endpoint.
6. Previewing never persists data and never sends an email.

## Error and Safety Behavior

- Empty values continue to follow the existing required-field validation.
- Rendering uses the production signature renderer's existing field-level fallback and HTML escaping.
- Failed Save or Publish operations continue to display their existing field feedback and do not affect the previewed editing value.
- The preview cannot modify recipients, sender addresses, order totals, signed order links or the production logo path.

## Automated Tests

- The combined preview displays all six signature fields and the official logo.
- The delivered HTML places a 72-pixel square Logo beside a four-line, 72-pixel-high contact block.
- Editing a signature field updates the combined preview immediately before Save.
- Signature fields no longer show the redundant single-field sample preview.
- Order-template fields retain their existing sample-variable preview.
- Unsafe display text remains escaped rather than interpreted as HTML.
- Existing Save draft and Publish tests remain green.

## Success Criteria

An Admin can open `/admin/settings/email-templates`, edit any customer-signature field and immediately see the complete final signature layout without sending an email. Nothing affects live customer emails until the existing Publish action succeeds.
