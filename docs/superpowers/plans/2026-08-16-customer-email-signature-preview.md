# Customer Email Signature Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe live preview of the complete customer email signature to the existing Admin email-template page.

**Architecture:** Lift editable entry values into `EmailTemplateForm` so the six signature fields can drive one combined preview. Reuse the production `renderCustomerEmailSignature` function for exact markup and escaping, while retaining the existing field-level save and publish endpoint.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, Vitest, Testing Library

## Global Constraints

- Preview the current unsaved signature values immediately.
- Reuse the production signature renderer and official logo.
- Keep Save draft and Publish behavior unchanged.
- Do not send email, create an email-preview API, modify orders or change payment/notification-delivery logic.
- Do not interpret administrator input as arbitrary HTML.
- Keep order-template sample-variable previews and remove only redundant signature-field previews.
- Use normal responsive document flow without sticky or floating preview behavior.
- Render the round 72-pixel Logo to the left of the four 18-pixel-high contact lines using an email-compatible presentation table.

---

## File Structure

- Modify `src/components/admin/email-template-form.tsx`: own all editable values, render the complete live signature preview, and keep individual field mutations intact.
- Modify `src/components/admin/email-template-form.test.tsx`: verify complete rendering, immediate updates, escaping, Logo output and preservation of existing template previews/save/publish behavior.
- Modify `src/components/admin/admin.module.css`: style the preview panel within the existing Admin design system and responsive flow.
- Modify `src/app/admin/settings/email-templates/page.tsx`: pass the trusted configured site URL into the client form so preview links and Logo match delivered email output.

### Task 1: Add the Complete Live Signature Preview

**Files:**
- Modify: `src/components/admin/email-template-form.test.tsx`
- Modify: `src/components/admin/email-template-form.tsx`
- Modify: `src/components/admin/admin.module.css`
- Modify: `src/app/admin/settings/email-templates/page.tsx`

**Interfaces:**
- Consumes: `renderCustomerEmailSignature(values: Partial<CustomerEmailSignatureValues>, siteUrl: string): Readonly<{ text: string; html: string }>` from `src/server/notifications/customer-email-signature.ts`.
- Produces: `EmailTemplateForm({ entries, canPublish, siteUrl }: { entries: readonly AdminEmailTemplateEntry[]; canPublish: boolean; siteUrl: string })`.
- Produces: a labelled `Live signature preview` region rendered from the six current signature values.

- [ ] **Step 1: Add complete signature fixtures and write the failing preview test**

Extend `src/components/admin/email-template-form.test.tsx` with six `Customer email signature` entries and render the form with `siteUrl="https://rrgallery.co.nz"`. Assert that the labelled preview contains all configured display values and the official absolute Logo URL:

```tsx
const signatureEntries = Object.freeze([
  ["email.signature.signoff", "Sign-off", "Kind regards,"],
  ["email.signature.team_name", "Team name", "Customer Service Team"],
  ["email.signature.company_line", "Company line", "Customer Service | R&R Gallery Ltd. NZ"],
  ["email.signature.email", "Customer-service email", "customerservice@rnrgallery.com"],
  ["email.signature.website_label", "Website label", "rrgallery.co.nz"],
  ["email.signature.address", "Street address", "11 Para Close, Fairview Heights, Auckland 0632."],
].map(([key, label, value]) => ({
  key,
  surface: "email" as const,
  group: "Customer email signature",
  label,
  description: `${label} used in customer emails.`,
  maxLength: 320,
  multiline: false,
  defaultValue: value,
  allowedVariables: [],
  draftValue: value,
  publishedValue: value,
  updatedAt: null,
  updatedByEmail: null,
}))) as readonly AdminEmailTemplateEntry[];

it("renders one complete live customer-signature preview", () => {
  render(<EmailTemplateForm entries={signatureEntries} canPublish siteUrl="https://rrgallery.co.nz" />);

  const preview = screen.getByRole("region", { name: "Live signature preview" });
  expect(preview).toHaveTextContent("Kind regards,");
  expect(preview).toHaveTextContent("Customer Service Team");
  expect(preview).toHaveTextContent("Customer Service | R&R Gallery Ltd. NZ");
  expect(preview).toHaveTextContent("customerservice@rnrgallery.com");
  expect(preview).toHaveTextContent("rrgallery.co.nz");
  expect(preview).toHaveTextContent("11 Para Close, Fairview Heights, Auckland 0632.");
  expect(preview.querySelector("img")).toHaveAttribute(
    "src",
    "https://rrgallery.co.nz/media/brand/rr-gallery-email-logo.png",
  );
  expect(screen.queryByText("Sample preview")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
npm test -- src/components/admin/email-template-form.test.tsx
```

Expected: FAIL because `EmailTemplateForm` does not accept `siteUrl` and no `Live signature preview` region exists.

- [ ] **Step 3: Write the failing real-time update and escaping test**

Add a test that edits the team-name field without clicking Save and verifies the combined preview updates. Use a string containing markup and assert that it remains text with no inserted element:

```tsx
it("updates the combined preview before save and keeps display text escaped", () => {
  const { container } = render(
    <EmailTemplateForm entries={signatureEntries} canPublish siteUrl="https://rrgallery.co.nz" />,
  );

  fireEvent.change(screen.getByDisplayValue("Customer Service Team"), {
    target: { value: "R&R <script>alert(1)</script> Care" },
  });

  const preview = screen.getByRole("region", { name: "Live signature preview" });
  expect(preview).toHaveTextContent("R&R <script>alert(1)</script> Care");
  expect(preview.querySelector("script")).toBeNull();
  expect(container.querySelector("[aria-label='Live signature preview']")).toBe(preview);
});
```

- [ ] **Step 4: Implement lifted editable state and the combined preview**

In `src/components/admin/email-template-form.tsx`:

1. Import `renderCustomerEmailSignature` and `CustomerEmailSignatureValues`.
2. Move editable values to one `EmailTemplateForm` state map initialized from `draftValue`.
3. Change `EmailTemplateEditor` to receive `value` and `onValueChange` props.
4. Add a focused preview helper that calls the existing renderer and displays its escaped HTML:

```tsx
function CustomerSignaturePreview({
  values,
  siteUrl,
}: Readonly<{
  values: Partial<CustomerEmailSignatureValues>;
  siteUrl: string;
}>) {
  const signature = renderCustomerEmailSignature(values, siteUrl);
  return (
    <section className={styles.signaturePreview} aria-label="Live signature preview">
      <h3>Live signature preview</h3>
      <p>Shows the current editing values. Save or publish separately.</p>
      <div dangerouslySetInnerHTML={{ __html: signature.html }} />
    </section>
  );
}
```

5. Render this helper once, directly below the `Customer email signature` group heading and before its editor cards.
6. Continue rendering the current `Sample preview` only when `entry.group !== "Customer email signature"`.
7. Keep `mutate("save")`, `mutate("publish")`, request bodies and confirmation behavior unchanged.

In `src/app/admin/settings/email-templates/page.tsx`, pass the trusted configured origin:

```tsx
<EmailTemplateForm
  entries={entries}
  canPublish={canPublish}
  siteUrl={process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000"}
/>
```

In `src/components/admin/admin.module.css`, add a non-sticky panel that uses the existing border, radius and white background tokens:

```css
.signaturePreview {
  padding: 18px;
  overflow-wrap: anywhere;
  border: 1px solid var(--admin-border);
  border-radius: 10px;
  background: #fff;
}

.signaturePreview > h3,
.signaturePreview > p {
  margin: 0;
}

.signaturePreview > p {
  margin-top: 4px;
  color: var(--admin-muted);
  font-size: 12px;
}

.signaturePreview > div {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e1e1e4;
}
```

- [ ] **Step 5: Update existing tests to pass the required site URL**

Change existing `EmailTemplateForm` renders in `src/components/admin/email-template-form.test.tsx` to include `siteUrl="https://rrgallery.co.nz"`. Do not weaken their current assertions for variable substitution, draft saving, publish confirmation or API validation errors.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
npm test -- src/components/admin/email-template-form.test.tsx
```

Expected: all `EmailTemplateForm` tests PASS with no React or HTML warnings.

- [ ] **Step 7: Run adjacent notification renderer tests**

Run:

```bash
npm test -- \
  src/server/notifications/customer-email-signature.test.ts \
  src/server/notifications/order-notification-service.test.ts \
  src/components/admin/email-template-form.test.tsx
```

Expected: all selected tests PASS, confirming the preview still uses the production-safe renderer and notification output is unchanged.

- [ ] **Step 8: Run static verification**

Run:

```bash
npx eslint \
  src/components/admin/email-template-form.tsx \
  src/components/admin/email-template-form.test.tsx \
  src/app/admin/settings/email-templates/page.tsx
npx tsc --noEmit
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 9: Run the production build**

Use the repository's established test-safe environment and run:

```bash
set -a
source .env.local
set +a
case "$TEST_DATABASE_URL" in *test*) ;; *) exit 2 ;; esac
DATABASE_URL="$TEST_DATABASE_URL" \
  BETTER_AUTH_URL="https://shop.example.test" \
  PAYMENT_RETURN_BASE_URL="https://shop.example.test" \
  BETTER_AUTH_SECRET="validation-only-secret-not-for-production-2026" \
  npm run build
```

Expected: production build PASS and `/admin/settings/email-templates` remains present in route output.

- [ ] **Step 10: Commit the implementation**

```bash
git add \
  src/components/admin/email-template-form.tsx \
  src/components/admin/email-template-form.test.tsx \
  src/components/admin/admin.module.css \
  src/app/admin/settings/email-templates/page.tsx
git commit -m "feat: preview customer email signature"
```

Do not add unrelated untracked audit files.
