# Customer Email Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append one Admin-managed R&R Gallery logo and customer-service signature to all customer-facing emails while leaving internal administrator notifications unchanged.

**Architecture:** Add a pure signature definition/renderer module and register its six plain-text fields with the existing `content_entries` draft/publish service. Each customer email path loads published signature values and appends the renderer's text and HTML fragments; the trusted server origin controls the logo and website destinations. Reuse the existing Admin email-template page, permissions, API, and audit flow without adding a database migration or HTML editor.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, existing Drizzle content storage, Resend provider, Vitest, Testing Library.

## Global Constraints

- Apply the signature to payment confirmed, payment failed, order shipped, proof ready, and password reset emails.
- Do not apply it to `admin_order_received`.
- Default visible website text is `rrgallery.co.nz`.
- Use `/media/brand/rr-gallery-logo-2026.webp` resolved against the trusted site origin.
- Admin may edit only sign-off, team name, company line, customer-service email, website label, and street address.
- Reject invalid email, URLs, HTML, scripts, malformed variables, and arbitrary image sources.
- Only published values affect new messages; field read failures use defaults.
- Keep recipients, sender, amounts, order/proof/reset links, signatures, expiry, idempotency, retries, and event triggers unchanged.
- Do not add dependencies, a schema migration, logo upload, rich text, tracking pixels, or historical resends.

---

### Task 1: Define and render the shared customer signature

**Files:**
- Create: `src/server/notifications/customer-email-signature.ts`
- Create: `src/server/notifications/customer-email-signature.test.ts`
- Modify: `src/server/admin/content-service.ts`
- Modify: `src/server/admin/content-service.test.ts`
- Modify: `src/server/notifications/order-email-templates.test.ts`

**Interfaces:**
- Produces: `customerEmailSignatureDefinitions`, `customerEmailSignatureKeys`, `CustomerEmailSignatureValues`, `defaultCustomerEmailSignatureValues`, and `renderCustomerEmailSignature(values, siteUrl)`.
- Consumes: existing `contentDefinitions`, `parseContentValue`, and trusted absolute site origins.

- [ ] **Step 1: Write failing pure-renderer tests**

Create `src/server/notifications/customer-email-signature.test.ts` and assert default rendering contains:

```ts
expect(signature.text).toContain("Kind regards,\nCustomer Service Team");
expect(signature.text).toContain("Customer Service | R&R Gallery Ltd. NZ");
expect(signature.text).toContain("customerservice@rnrgallery.com");
expect(signature.text).toContain("rrgallery.co.nz");
expect(signature.text).toContain("11 Para Close, Fairview Heights, Auckland 0632.");
expect(signature.html).toContain(
  'src="https://rrgallery.co.nz/media/brand/rr-gallery-logo-2026.webp"',
);
expect(signature.html).toContain('alt="R&amp;R Gallery"');
expect(signature.html).toContain('href="https://rrgallery.co.nz/"');
expect(signature.html).toContain('href="mailto:customerservice@rnrgallery.com"');
```

Add tests proving a published display-text override is escaped, a missing field falls back independently, and changing the website label cannot change the trusted link destination.

- [ ] **Step 2: Write failing content validation tests**

Extend `src/server/admin/content-service.test.ts` to require six additional email-surface definitions and assert:

```ts
expect(parseContentValue(
  "email.signature.email",
  "customerservice@rnrgallery.com",
)).toBe("customerservice@rnrgallery.com");
expect(() => parseContentValue(
  "email.signature.email",
  "not-an-email",
)).toThrow("Enter a valid customer-service email");
expect(() => parseContentValue(
  "email.signature.website_label",
  "https://attacker.example",
)).toThrow("Email template URLs are managed by the system");
```

Update the email-template definition count expectation in `src/server/notifications/order-email-templates.test.ts` only if it currently counts the entire email content surface; the order template key count itself must remain 12.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- --run src/server/notifications/customer-email-signature.test.ts src/server/admin/content-service.test.ts src/server/notifications/order-email-templates.test.ts
```

Expected: FAIL because the signature module and fields do not exist.

- [ ] **Step 4: Implement the six definitions and renderer**

Create `src/server/notifications/customer-email-signature.ts` with six `surface: "email"` definitions:

```text
email.signature.signoff
email.signature.team_name
email.signature.company_line
email.signature.email
email.signature.website_label
email.signature.address
```

Use the approved defaults. Each field has no template variables. Export:

```ts
export function renderCustomerEmailSignature(
  values: Partial<CustomerEmailSignatureValues>,
  siteUrl: string,
): Readonly<{ text: string; html: string }>;
```

The renderer must:

1. Resolve each field independently against its default.
2. Parse `siteUrl` with `new URL`, use its origin for the visible website destination, and resolve the fixed logo path from that origin.
3. HTML-escape every editable field.
4. Percent-encode the validated email for the `mailto:` attribute.
5. Produce email-safe inline layout with a 120px-wide proportional logo and `alt="R&R Gallery"`.
6. Produce a complete plain-text fallback without HTML or image dependency.

Register `customerEmailSignatureDefinitions` in `src/server/admin/content-service.ts`. Add the exact email-address validation for `email.signature.email`; keep all existing email-surface URL, HTML, and malformed-variable checks.

- [ ] **Step 5: Run GREEN tests and commit**

Run:

```bash
npm test -- --run src/server/notifications/customer-email-signature.test.ts src/server/admin/content-service.test.ts src/server/notifications/order-email-templates.test.ts
```

Expected: all selected tests PASS.

Commit:

```bash
git add src/server/notifications/customer-email-signature.ts src/server/notifications/customer-email-signature.test.ts src/server/admin/content-service.ts src/server/admin/content-service.test.ts src/server/notifications/order-email-templates.test.ts
git commit -m "feat: define customer email signature"
```

---

### Task 2: Append the signature to order and proof emails

**Files:**
- Modify: `src/server/notifications/order-notification-service.ts`
- Modify: `src/server/notifications/order-notification-service.test.ts`
- Modify: `src/server/notifications/order-notification-runtime.ts`
- Modify: `src/server/notifications/customer-notification-service.ts`
- Modify: `src/server/notifications/customer-notification-service.test.ts`
- Modify: `src/server/notifications/customer-notification-runtime.ts`

**Interfaces:**
- Consumes: `renderCustomerEmailSignature`, `customerEmailSignatureKeys`, `defaultCustomerEmailSignatureValues`, and `CustomerEmailSignatureValues` from Task 1.
- Produces: optional `loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>` dependency in both notification services.

- [ ] **Step 1: Write failing order-email integration tests**

Extend `src/server/notifications/order-notification-service.test.ts` so the customer payment-confirmed, payment-failed, and shipped cases assert both text and HTML contain `Customer Service Team` and the trusted logo URL. Add an `admin_order_received` assertion that neither text nor HTML contains `Customer Service Team` or the logo path.

Inject a published signature override and assert it changes only the footer while preserving:

```ts
expect(message.to).toBe(delivery.recipientEmail);
expect(message.idempotencyKey).toBe(delivery.eventKey);
expect(verifyOrderEmailAccessToken(/* existing signed URL values */)).toBe(true);
```

- [ ] **Step 2: Write failing proof-email integration tests**

Extend `src/server/notifications/customer-notification-service.test.ts` with `loadPublishedSignature` and assert the proof message contains the shared footer while its proof URL, signature, expiry, recipient, event key, and retry behavior are unchanged.

- [ ] **Step 3: Run RED notification tests**

Run:

```bash
npm test -- --run src/server/notifications/order-notification-service.test.ts src/server/notifications/customer-notification-service.test.ts
```

Expected: FAIL because the two services do not append the shared signature.

- [ ] **Step 4: Integrate the signature without changing protected message data**

In `order-notification-service.ts`:

1. Load published signature values once per delivery batch, with default fallback on read error.
2. For customer notification kinds, append `signature.text` and `signature.html` after the existing action link.
3. Preserve the current simple `R&R Gallery` ending for `admin_order_received`.

In `customer-notification-service.ts`:

1. Add `loadPublishedSignature` to dependencies.
2. Load once for `deliverPending` and once for an explicit `deliverForFile` operation.
3. Append the shared footer after the proof action link.
4. Preserve proof signing, expiry, retry, and repository state transitions.

Wire both runtimes to `getSafePublicContent(customerEmailSignatureKeys)`.

- [ ] **Step 5: Run GREEN notification tests and commit**

Run:

```bash
npm test -- --run src/server/notifications/order-notification-service.test.ts src/server/notifications/customer-notification-service.test.ts
```

Expected: both files PASS.

Commit:

```bash
git add src/server/notifications/order-notification-service.ts src/server/notifications/order-notification-service.test.ts src/server/notifications/order-notification-runtime.ts src/server/notifications/customer-notification-service.ts src/server/notifications/customer-notification-service.test.ts src/server/notifications/customer-notification-runtime.ts
git commit -m "feat: add signature to customer notifications"
```

---

### Task 3: Append the signature to password reset and expose Admin fields

**Files:**
- Modify: `src/server/auth/password-reset-email.ts`
- Modify: `src/server/auth/password-reset-email.test.ts`
- Modify: `src/server/auth.ts`
- Modify: `src/app/admin/settings/email-templates/page.test.tsx`
- Modify: `src/components/admin/email-template-form.test.tsx`

**Interfaces:**
- Consumes: shared signature APIs from Task 1 and existing Admin email-template page from the earlier feature.
- Produces: password-reset sender dependency `loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>` and environment field `BETTER_AUTH_URL?: string`.

- [ ] **Step 1: Write failing password-reset tests**

Extend `src/server/auth/password-reset-email.test.ts` to inject published signature values and assert the Resend payload contains the logo and text signature while preserving:

- Recipient email
- Subject
- Reset URL
- One-hour expiry wording
- Token-derived hashed idempotency key

Add a rejected-loader test proving the default signature is still sent.

- [ ] **Step 2: Write failing Admin visibility tests**

Extend `src/app/admin/settings/email-templates/page.test.tsx` with signature entries and require the `Customer email signature` heading and its six fields. Extend `src/components/admin/email-template-form.test.tsx` to verify these no-variable fields use the same draft/publish endpoint and show no arbitrary HTML or URL input.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- --run src/server/auth/password-reset-email.test.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx
```

Expected: FAIL because password-reset output has no shared signature and the signature entries are not yet represented in page fixtures.

- [ ] **Step 4: Integrate password reset and Admin data**

In `password-reset-email.ts`:

1. Add optional `BETTER_AUTH_URL` to the environment type.
2. Add an injectable signature loader whose runtime default calls `getSafePublicContent(customerEmailSignatureKeys)`.
3. Use the validated `BETTER_AUTH_URL` origin; fall back to the already validated reset URL origin only when the environment value is unavailable.
4. Append the rendered shared signature to text and HTML.
5. Catch signature-read failures and use defaults so password reset cannot be blocked by editable content.

Pass `process.env.BETTER_AUTH_URL` from `src/server/auth.ts`. No Admin component production change should be necessary because the existing email-surface listing automatically includes the six definitions.

- [ ] **Step 5: Run GREEN tests and commit**

Run:

```bash
npm test -- --run src/server/auth/password-reset-email.test.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx
```

Expected: all selected tests PASS.

Commit:

```bash
git add src/server/auth/password-reset-email.ts src/server/auth/password-reset-email.test.ts src/server/auth.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx
git commit -m "feat: add signature to password reset email"
```

---

### Task 4: Verify all customer email paths

**Files:**
- Modify only files already listed when a concrete verification failure requires a fix.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a verified branch ready for an explicit integration/deployment decision.

- [ ] **Step 1: Run focused signature and email tests**

Run:

```bash
npm test -- --run src/server/notifications/customer-email-signature.test.ts src/server/admin/content-service.test.ts src/server/notifications/order-email-templates.test.ts src/server/notifications/order-notification-service.test.ts src/server/notifications/customer-notification-service.test.ts src/server/auth/password-reset-email.test.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 2: Run TypeScript and changed-file ESLint**

Run:

```bash
npm run typecheck
npx eslint src/server/notifications/customer-email-signature.ts src/server/notifications/customer-email-signature.test.ts src/server/admin/content-service.ts src/server/admin/content-service.test.ts src/server/notifications/order-email-templates.test.ts src/server/notifications/order-notification-service.ts src/server/notifications/order-notification-service.test.ts src/server/notifications/order-notification-runtime.ts src/server/notifications/customer-notification-service.ts src/server/notifications/customer-notification-service.test.ts src/server/notifications/customer-notification-runtime.ts src/server/auth/password-reset-email.ts src/server/auth/password-reset-email.test.ts src/server/auth.ts src/app/admin/settings/email-templates/page.test.tsx src/components/admin/email-template-form.test.tsx
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the complete suite with the dedicated test database**

Load `.env.local` without printing secrets, verify `TEST_DATABASE_URL` contains `test`, and run:

```bash
npm test -- --run
```

Expected: exit 0. Record exact passed, skipped, and failed totals.

- [ ] **Step 4: Run a production build without disturbing the LAN dev server**

Use the dedicated test database and validation-only `BETTER_AUTH_URL`, `PAYMENT_RETURN_BASE_URL`, and `BETTER_AUTH_SECRET`, then run:

```bash
npm run build
```

Expected: exit 0. Restart the LAN development service afterwards because `next build` and `next dev` share the worktree output directory.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --check HEAD~3..HEAD
git status --short
git log -7 --oneline
```

Confirm there is no schema migration, secret, arbitrary image URL, recipient/sender edit control, payment/order mutation, or change to unrelated untracked files.

- [ ] **Step 6: Stop before production deployment**

Report exact verification evidence and the Admin location. Deployment and a controlled real-email rendering check require explicit production authorization.
