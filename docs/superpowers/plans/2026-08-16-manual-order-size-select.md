# Manual Order Size Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-order Size text field with the existing standard size select and hide the unused manual-entry Design & Notes section.

**Architecture:** Keep `ProductionJobForm` as the shared form used by Admin and the Forms portal. Import the already maintained `FORM_OPTION_SETS.size` list, render it as a required select, and leave the existing `Size other` override and request payload contract unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library.

## Global Constraints

- Do not append Canvas centimetre conversions or price information to option labels.
- Keep `Size other` and its existing override behaviour.
- Hide only the manual-entry `Design & Notes` interface; do not remove stored fields or online-order data.
- Do not change product pricing, GST, invoices, payments, order numbering, database schema, or online product configuration.

---

### Task 1: Standard Size Select and Hidden Notes Section

**Files:**
- Modify: `src/components/admin/production-job-form.test.tsx`
- Modify: `src/components/admin/production-job-form.tsx`

**Interfaces:**
- Consumes: `FORM_OPTION_SETS.size` from `src/domain/forms/forms-parity.ts`.
- Produces: a required `<select name="item-{key}-size">` whose submitted string remains compatible with the current production-job request.

- [ ] **Step 1: Write failing component tests**

Add tests that render `ProductionJobForm` and assert:

```tsx
const size = screen.getByRole("combobox", { name: "Size" });
expect(size).toHaveDisplayValue("Please choose");
expect(within(size).getAllByRole("option").map((option) => option.textContent)).toEqual([
  "Please choose",
  "A0", "A1", "A2", "A3", "A4", "A5",
  "Banner 80x160cm", "Banner 100x200cm", "PullUpBanner",
  "Banner 150x300cm", "Custom Size", "Other",
]);
expect(screen.queryByRole("heading", { name: "Design & Notes" })).not.toBeInTheDocument();
expect(screen.queryByLabelText("Artwork direction")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Item notes")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Design requirements")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Internal notes")).not.toBeInTheDocument();
```

Extend the existing successful-submit coverage to prove selecting `A2` submits `sizeLabel: "A2"`. Add a focused case that selects `A2`, enters `Custom 90 × 180 cm` into `Size other`, submits, and asserts `sizeLabel: "Custom 90 × 180 cm"`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/components/admin/production-job-form.test.tsx
```

Expected: FAIL because `Size` is still a textbox and the Design & Notes fields are still rendered.

- [ ] **Step 3: Implement the minimal component change**

In `production-job-form.tsx`:

```tsx
import { FORM_OPTION_SETS } from "@/domain/forms/forms-parity";
```

Replace the Size input with:

```tsx
<label>
  <span>Size</span>
  <select name={`item-${key}-size`} defaultValue="" required disabled={pending}>
    <option value="" disabled>Please choose</option>
    {FORM_OPTION_SETS.size.map((size) => <option key={size} value={size}>{size}</option>)}
  </select>
</label>
```

Remove only the rendered `Design & Notes` section. Keep request construction for `designText`, item `notes`, `designRequirements`, and `internalNotes`; absent form entries continue becoming empty strings through the existing `String(form.get(...) ?? "")` expressions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/components/admin/production-job-form.test.tsx src/components/forms/forms-order-entry-drawer.test.tsx src/app/forms/'(portal)'/new/page.test.tsx src/app/admin/jobs/new/page.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Verify in the local browser**

At `http://192.168.4.199:3000/order-system`, open Order entry and verify at desktop width and 390px:

- Size is a usable required select containing all standard options.
- Canvas A-size labels do not include centimetre conversions.
- `Size other` remains available.
- `Design & Notes` is absent.
- No positive horizontal overflow appears.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/production-job-form.tsx src/components/admin/production-job-form.test.tsx
git commit -m "feat: standardize manual order size entry"
```
