# Admin Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Admin settings page where the four current automated order-email templates can be drafted, previewed, and published without exposing payment, recipient, or signed-link controls.

**Architecture:** Keep `content_entries` as the single persistence layer and extend its existing draft/publish/audit service with email-scoped definitions. Put email template defaults, allowed variables, validation metadata, and rendering in one notification module, then inject published values into the existing notification delivery service at send time. Reuse the existing content mutation API and Admin permissions; add only a dedicated settings page and client editor.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM/PostgreSQL, Vitest, Testing Library, existing Admin CSS and content mutation API.

## Global Constraints

- Support customer payment confirmed, customer payment failed, admin new paid order, and customer order shipped emails.
- Editable fields are subject, body, and action-button label only.
- Reuse `content_entries`, the existing draft/publish workflow, `manage_content`/`publish_content` permissions, and existing audit records.
- Only published values affect new deliveries; missing or unreadable values use code defaults.
- Allow only `{{customer_name}}`, `{{order_number}}`, `{{amount}}`, `{{tracking_number}}`, and `{{tracking_carrier}}` where relevant.
- Reject unknown variables, malformed placeholders, angle brackets, and URL text in email templates.
- Keep recipients, sender, event kind, idempotency, order values, payment state, tracking source, signed URLs, retries, and provider delivery code-controlled.
- Preview only with fixed fictional sample data.
- Do not change prices, payment processing, order creation, authentication, cart identity isolation, shipping, or completed orders.
- Do not add dependencies or a database migration.

---

### Task 1: Define safe order-email templates and validation

**Files:**
- Create: `src/server/notifications/order-email-templates.ts`
- Create: `src/server/notifications/order-email-templates.test.ts`
- Modify: `src/server/admin/content-service.ts`
- Modify: `src/server/admin/content-service.test.ts`

**Interfaces:**
- Produces: `orderEmailTemplateDefinitions`, `orderEmailTemplateKeys`, `OrderEmailTemplateKey`, `OrderEmailTemplateValues`, `defaultOrderEmailTemplateValues`, and `renderOrderEmailTemplate(kind, values, variables)`.
- Produces: `listAdminContent(database, surface)` where `surface` is `"storefront" | "email"` and defaults to `"storefront"`.
- Consumes: existing `OrderNotificationKind` and existing `content_entries` persistence.

- [ ] **Step 1: Write failing template-definition and renderer tests**

Create `src/server/notifications/order-email-templates.test.ts` with tests that assert:

```ts
expect(orderEmailTemplateDefinitions).toHaveLength(12);
expect(new Set(orderEmailTemplateKeys).size).toBe(12);
expect(defaultOrderEmailTemplateValues["email.payment_confirmed.subject"])
  .toBe("Payment confirmed — {{order_number}}");

expect(renderOrderEmailTemplate("payment_confirmed", {
  ...defaultOrderEmailTemplateValues,
  "email.payment_confirmed.subject": "Receipt for {{order_number}}",
  "email.payment_confirmed.body": "Paid {{amount}} safely.",
  "email.payment_confirmed.action_label": "Open order",
}, {
  customerName: "Aroha & Co",
  orderNumber: "RNR-2026-ABC123",
  amount: "NZ$120.75",
  trackingNumber: null,
  trackingCarrier: null,
})).toEqual({
  subject: "Receipt for RNR-2026-ABC123",
  paragraphs: ["Paid NZ$120.75 safely."],
  actionLabel: "Open order",
});
```

Also assert that the shipped tracking paragraph is omitted when both tracking values are null and retained when both are present.

- [ ] **Step 2: Extend failing content validation tests**

In `src/server/admin/content-service.test.ts`, add exact assertions that:

```ts
expect(parseContentValue(
  "email.payment_confirmed.subject",
  "Payment received — {{order_number}}",
)).toBe("Payment received — {{order_number}}");

expect(() => parseContentValue(
  "email.payment_confirmed.body",
  "Hello {{email}}",
)).toThrow("Unknown email template variable: email");

expect(() => parseContentValue(
  "email.payment_confirmed.body",
  "Open https://example.test",
)).toThrow("Email template URLs are managed by the system");

expect(() => parseContentValue(
  "email.payment_confirmed.body",
  "Hello {{order_number",
)).toThrow("Malformed email template variable");
```

Assert that storefront content still excludes the email surface and an email-surface listing includes only the 12 email fields.

- [ ] **Step 3: Run the focused tests to verify failure**

Run:

```bash
npm test -- --run src/server/notifications/order-email-templates.test.ts src/server/admin/content-service.test.ts
```

Expected: FAIL because the email template module, definitions, validation, and surface filtering do not exist.

- [ ] **Step 4: Implement the template definitions and pure renderer**

Create `src/server/notifications/order-email-templates.ts` with this public model:

```ts
export type OrderEmailTemplateVariables = Readonly<{
  customerName: string;
  orderNumber: string;
  amount: string;
  trackingNumber: string | null;
  trackingCarrier: string | null;
}>;

export function renderOrderEmailTemplate(
  kind: OrderNotificationKind,
  values: Partial<OrderEmailTemplateValues>,
  variables: OrderEmailTemplateVariables,
): Readonly<{ subject: string; paragraphs: readonly string[]; actionLabel: string }>;
```

Define three namespaced fields for every notification kind:

```ts
email.admin_order_received.subject
email.admin_order_received.body
email.admin_order_received.action_label
email.payment_confirmed.subject
email.payment_confirmed.body
email.payment_confirmed.action_label
email.payment_failed.subject
email.payment_failed.body
email.payment_failed.action_label
email.order_shipped.subject
email.order_shipped.body
email.order_shipped.action_label
```

Each definition contains `surface: "email"`, label, description, maximum length, multiline flag, default value, and only the variables applicable to that event. Preserve the current hard-coded wording as defaults. Represent separate paragraphs with blank lines. For the shipped tracking paragraph, omit the complete paragraph when its tracking placeholders have no values.

The pure renderer must:

1. Select the three fields for the requested kind.
2. Fall back field-by-field to definition defaults.
3. Replace only allowlisted placeholders.
4. Split the body on blank lines into non-empty paragraphs.
5. Return plain text strings; do not emit HTML or URLs.

- [ ] **Step 5: Extend content definitions without exposing them on `/admin/content`**

In `src/server/admin/content-service.ts`:

1. Add `surface: "storefront"` to existing storefront definitions.
2. Append `orderEmailTemplateDefinitions` to `contentDefinitions`.
3. Update `parseContentValue` so email fields reject malformed braces, variables absent from that field's `allowedVariables`, `/https?:\/\//i`, and `/\bwww\./i`.
4. Keep the existing non-empty, length, and angle-bracket checks.
5. Change `listAdminContent(database, surface = "storefront")` to filter definitions before mapping database rows.

Do not change `saveContentDraft`, `publishContent`, or their audit payloads; they continue to work because email keys are now approved definitions.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm test -- --run src/server/notifications/order-email-templates.test.ts src/server/admin/content-service.test.ts
```

Expected: both files PASS.

Commit:

```bash
git add src/server/notifications/order-email-templates.ts src/server/notifications/order-email-templates.test.ts src/server/admin/content-service.ts src/server/admin/content-service.test.ts
git commit -m "feat: define safe order email templates"
```

---

### Task 2: Render published templates during notification delivery

**Files:**
- Modify: `src/server/notifications/order-notification-service.ts`
- Modify: `src/server/notifications/order-notification-service.test.ts`
- Modify: `src/server/notifications/order-notification-runtime.ts`
- Modify: `src/server/admin/admin-content-runtime.ts`

**Interfaces:**
- Consumes: `renderOrderEmailTemplate`, `defaultOrderEmailTemplateValues`, `orderEmailTemplateKeys`, and `OrderEmailTemplateValues` from Task 1.
- Produces: optional notification-service dependency `loadPublishedTemplates?: () => Promise<Partial<OrderEmailTemplateValues>>`.
- Produces: `getAdminContentRuntime().listEmailTemplates()` and uses `getSafePublicContent(orderEmailTemplateKeys)` for delivery.

- [ ] **Step 1: Write failing notification integration tests**

Extend `src/server/notifications/order-notification-service.test.ts` with tests that inject:

```ts
loadPublishedTemplates: vi.fn().mockResolvedValue({
  "email.payment_confirmed.subject": "Receipt — {{order_number}}",
  "email.payment_confirmed.body": "We received {{amount}}.",
  "email.payment_confirmed.action_label": "See receipt",
}),
```

Assert the provider receives the customized subject, text, and escaped HTML while its `to`, `idempotencyKey`, and signed order URL remain unchanged. Include customer name `Aroha <script>alert(1)</script>` and assert the HTML contains escaped text, never a `<script>` element.

Add separate tests asserting:

- A rejected template loader falls back to current defaults and still sends.
- Templates for `payment_failed` do not alter a `payment_confirmed` message.
- The loader is called once for a delivery batch, not once per field.

- [ ] **Step 2: Run the notification test to verify failure**

Run:

```bash
npm test -- --run src/server/notifications/order-notification-service.test.ts
```

Expected: FAIL because published templates are not loaded or rendered.

- [ ] **Step 3: Inject published values into the existing delivery service**

In `src/server/notifications/order-notification-service.ts`:

1. Add optional `loadPublishedTemplates` to dependencies.
2. Resolve it once at the start of `deliverPending`; catch read failure and use `defaultOrderEmailTemplateValues`.
3. Pass resolved values to `orderMessage`.
4. Replace only the hard-coded subject, paragraphs, and action label with `renderOrderEmailTemplate` output.
5. Keep greeting selection, action URL construction, signed access token, escaping, recipient, idempotency, retry delays, stale-failure discard, and provider calls unchanged.

In `src/server/admin/admin-content-runtime.ts`, add:

```ts
listEmailTemplates: () => listAdminContent(database, "email"),
```

In `src/server/notifications/order-notification-runtime.ts`, provide:

```ts
loadPublishedTemplates: () => getSafePublicContent(orderEmailTemplateKeys),
```

The database read returns published values only, so drafts cannot affect outgoing messages.

- [ ] **Step 4: Run notification and content regression tests**

Run:

```bash
npm test -- --run src/server/notifications/order-notification-service.test.ts src/server/admin/content-service.test.ts
```

Expected: both files PASS, including original recipient, retry, AUD currency, admin-link, and signed-link assertions.

- [ ] **Step 5: Commit**

```bash
git add src/server/notifications/order-notification-service.ts src/server/notifications/order-notification-service.test.ts src/server/notifications/order-notification-runtime.ts src/server/admin/admin-content-runtime.ts
git commit -m "feat: render published order email templates"
```

---

### Task 3: Add the dedicated Admin email-template editor

**Files:**
- Create: `src/app/admin/settings/email-templates/page.tsx`
- Create: `src/app/admin/settings/email-templates/page.test.tsx`
- Create: `src/components/admin/email-template-form.tsx`
- Create: `src/components/admin/email-template-form.test.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`
- Modify: `src/components/admin/admin.module.css`
- Modify: `src/app/api/admin/content/[key]/route.test.ts`

**Interfaces:**
- Consumes: `getAdminContentRuntime().listEmailTemplates()` from Task 2.
- Consumes: existing `PATCH /api/admin/content/[key]` actions `save` and `publish`.
- Produces: Admin route `/admin/settings/email-templates` protected by `manage_content` and a navigation item named `Email templates`.

- [ ] **Step 1: Write failing page and navigation tests**

Create `src/app/admin/settings/email-templates/page.test.tsx` that mocks the Admin page guard and runtime, then asserts:

```ts
expect(requireAdminPage).toHaveBeenCalledWith(
  "/admin/settings/email-templates",
  "manage_content",
);
expect(screen.getByRole("heading", { name: "Email templates" })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: "Customer payment confirmed" })).toBeInTheDocument();
```

Assert staff see the draft-only safety message and no Publish button.

Update `src/components/admin/admin-shell.test.tsx` to require:

```ts
["Email templates", "/admin/settings/email-templates"]
```

for both administrators and staff, since both roles already have `manage_content`.

- [ ] **Step 2: Write failing editor tests**

Create `src/components/admin/email-template-form.test.tsx` with a single fictional entry set and assert:

- Preview replaces `{{customer_name}}`, `{{order_number}}`, and `{{amount}}` with `Sample Customer`, `RNR-SAMPLE-1001`, and `NZ$264.50`.
- The raw variable names remain visible beside fields.
- Save draft sends the existing PATCH body `{ action: "save", value, idempotencyKey }`.
- Publish asks for confirmation and sends `{ action: "publish", value, idempotencyKey }` only when confirmed.
- API validation errors render in an `aria-live` region beside the edited field.
- No real order lookup or customer data is requested.

- [ ] **Step 3: Extend the content route regression test for email keys**

In `src/app/api/admin/content/[key]/route.test.ts`, call the existing handler with `email.payment_confirmed.subject` and assert staff can save its draft but cannot publish it. This proves the new page does not bypass existing permission or trusted-origin controls.

- [ ] **Step 4: Run UI tests to verify failure**

Run:

```bash
npm test -- --run src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx src/components/admin/admin-shell.test.tsx 'src/app/api/admin/content/[key]/route.test.ts'
```

Expected: FAIL because the route, editor, and navigation entry do not exist.

- [ ] **Step 5: Implement the server page and client editor**

Create `src/app/admin/settings/email-templates/page.tsx` with:

```ts
const access = await requireAdminPage(
  "/admin/settings/email-templates",
  "manage_content",
);
const entries = await getAdminContentRuntime().listEmailTemplates();
const canPublish = access.adminRole === "admin";
```

Render a breadcrumb, the `Email templates` heading, a plain-text/safety explanation, the staff draft-only banner, and `EmailTemplateForm`.

Create `src/components/admin/email-template-form.tsx` using the existing Admin form classes and one section per notification group. Each editor must:

1. Show label, description, stable key, allowed variables, draft value, published value, and update metadata.
2. Use an input for subject/action labels and textarea for body.
3. Render a client-only preview by substituting these constants:

```ts
const sampleVariables = {
  customer_name: "Sample Customer",
  order_number: "RNR-SAMPLE-1001",
  amount: "NZ$264.50",
  tracking_number: "SAMPLE123",
  tracking_carrier: "NZ Post",
} as const;
```

4. Save and publish through the existing content endpoint with `createClientId()`.
5. Never request, accept, or display real order data.

Add the navigation item in `src/components/admin/admin-shell.tsx` with permission `manage_content`. Add only the small CSS additions needed for the variables and preview, preserving current responsive layout.

- [ ] **Step 6: Run the focused UI/API tests**

Run:

```bash
npm test -- --run src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx src/components/admin/admin-shell.test.tsx 'src/app/api/admin/content/[key]/route.test.ts'
```

Expected: all four files PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/settings/email-templates/page.tsx src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.tsx src/components/admin/email-template-form.test.tsx src/components/admin/admin-shell.tsx src/components/admin/admin-shell.test.tsx src/components/admin/admin.module.css 'src/app/api/admin/content/[key]/route.test.ts'
git commit -m "feat: add admin email template editor"
```

---

### Task 4: Verify the complete feature and deployment safety

**Files:**
- Modify only files already listed if a concrete verification failure requires a fix.

**Interfaces:**
- Consumes: all Tasks 1–3.
- Produces: verified production-build artifact; no production deployment is included in this task.

- [ ] **Step 1: Run all focused feature tests together**

Run:

```bash
npm test -- --run src/server/notifications/order-email-templates.test.ts src/server/admin/content-service.test.ts src/server/notifications/order-notification-service.test.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx src/components/admin/admin-shell.test.tsx 'src/app/api/admin/content/[key]/route.test.ts'
```

Expected: all selected test files PASS with zero failures.

- [ ] **Step 2: Run static validation**

Run:

```bash
npm run typecheck
npx eslint src/server/notifications/order-email-templates.ts src/server/notifications/order-email-templates.test.ts src/server/admin/content-service.ts src/server/admin/content-service.test.ts src/server/notifications/order-notification-service.ts src/server/notifications/order-notification-service.test.ts src/server/notifications/order-notification-runtime.ts src/server/admin/admin-content-runtime.ts src/app/admin/settings/email-templates/page.tsx src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.tsx src/components/admin/email-template-form.test.tsx src/components/admin/admin-shell.tsx src/components/admin/admin-shell.test.tsx 'src/app/api/admin/content/[key]/route.test.ts'
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the full regression suite**

Run:

```bash
npm test -- --run
```

Expected: exit 0 with no new failures. Record exact passed, skipped, and failed totals.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: exit 0 and `/admin/settings/email-templates` appears in the route output.

- [ ] **Step 5: Review the final diff and protected behavior**

Run:

```bash
git diff --check HEAD~3..HEAD
git status --short
git log -4 --oneline
```

Confirm the diff contains no schema migration, secrets, recipient editing, sender editing, payment calculation changes, order-state changes, or modifications to unrelated untracked files.

- [ ] **Step 6: Stop before production deployment**

Report the exact test/build results and remaining manual check: open the Admin page, save a draft, verify it does not affect delivery, publish a harmless wording change, and send a controlled test notification. Deploy only after explicit production authorization.
