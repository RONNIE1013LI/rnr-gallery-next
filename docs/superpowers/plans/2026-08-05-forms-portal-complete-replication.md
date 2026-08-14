# R&R Gallery Forms Portal Complete Replication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated `/forms` staff portal that reproduces the complete daily R&R Gallery Order Manager/eTeams workflow while sharing the existing Next.js production, ecommerce, file, invoice and audit data.

**Architecture:** Add a form-only access layer and shell in front of the existing production services. A portal-specific read model supplies the dense list and statistics, while all mutations continue through the current production, invoice and upload services so web orders retain their typed checkout authority. The implementation is additive: `/admin` and the storefront remain intact.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Better Auth 1.6, Drizzle ORM 0.45/PostgreSQL, Zod 4, Vitest/Testing Library, CSS Modules.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-08-05-forms-portal-complete-replication-design.md`.
- The local source plugin at `/Users/ronnieli/Documents/表单/rr-gallery-order-manager` is the behavioural and field-parity reference; do not modify it.
- Use only `http://192.168.4.199:3000` for current-site browser validation.
- Preserve storefront, checkout, pricing, GST, shipping, payment, customer-account and web-order behaviour.
- Reuse `production_jobs`, typed orders, files, invoices, saved views and audit services; do not create a second order database.
- Manual jobs must not create false ecommerce orders.
- Web prices, GST, payment and order status remain read-only projections of their typed order snapshots.
- Use current R&R Gallery design tokens; do not introduce a parallel design system.
- Do not import historical eTeams customer/order data in this implementation.
- Do not stash, reset, clean, revert or delete existing uncommitted work.
- Do not commit during this implementation; the worktree contains other approved work in progress.

---

## File structure

### New portal files

- `src/app/forms/layout.tsx` — neutral forms root metadata/layout so sign-in remains public.
- `src/app/forms/(portal)/layout.tsx` — form access gate and compact portal shell.
- `src/app/forms/(portal)/page.tsx` — server-rendered Data list entry.
- `src/app/forms/sign-in/page.tsx` — staff sign-in surface.
- `src/app/forms/(portal)/new/page.tsx` — full-page manual-entry fallback.
- `src/app/forms/(portal)/jobs/[jobId]/page.tsx` — full-page order editor fallback.
- `src/app/forms/(portal)/stats/page.tsx` — custom statistics workspace.
- `src/app/api/forms/jobs/route.ts` — protected list/create endpoint.
- `src/app/api/forms/jobs/export/route.ts` — protected filtered CSV export using the existing export service.
- `src/app/api/forms/jobs/[jobId]/route.ts` — protected detail/update endpoint.
- `src/app/api/forms/jobs/[jobId]/files/route.ts` and nested file route — protected file operations reusing current services.
- `src/app/api/forms/jobs/[jobId]/proof-reviews/route.ts` — protected proof review operations reusing current services.
- `src/app/api/forms/jobs/[jobId]/invoice/route.ts` and invoice PDF route — protected invoice operations reusing current services.
- `src/app/api/forms/views/route.ts` and `[viewId]/route.ts` — form saved-view operations.
- `src/app/api/forms/stats/route.ts` and `layout/route.ts` — bounded aggregates and saved layouts.
- `src/components/forms/forms-shell.tsx` — compact Data list / Custom stats navigation.
- `src/components/forms/forms-workbench.tsx` — list state, filter and drawer coordinator.
- `src/components/forms/forms-filter-builder.tsx` — advanced AND/OR filters.
- `src/components/forms/forms-order-table.tsx` — dense desktop list and inline cells.
- `src/components/forms/forms-order-cards.tsx` — mobile order list.
- `src/components/forms/forms-job-drawer.tsx` — resizable editor drawer.
- `src/components/forms/forms-job-editor.tsx` — source-parity grouped editor.
- `src/components/forms/forms-stats-workbench.tsx` — custom widgets and Column stats.
- `src/components/forms/forms.module.css` — portal-only layout using existing tokens.
- `src/domain/forms/forms-parity.ts` — canonical columns, labels, options and widget types.
- `src/server/forms/forms-permissions.ts` — form roles and capability checks.
- `src/server/forms/require-forms.ts` and `require-forms-page.ts` — API/page gates.
- `src/server/forms/forms-workbench-service.ts` — filter parsing, list projection and safe inline mutation envelopes.
- `src/server/forms/drizzle-forms-workbench-repository.ts` — portal list/detail/stat queries.
- `src/server/forms/forms-stats-service.ts` — bounded aggregate and layout validation.

### Existing files extended, not replaced

- `src/server/db/schema/auth.ts` — allow `form_staff`.
- `src/server/db/schema/production.ts` — form access profile and stats layout tables.
- `src/server/db/schema/index.ts` — export added tables.
- `src/server/auth/admin-permissions.ts` — keep `form_staff` outside admin roles.
- `src/server/auth/require-admin.ts` — unchanged admin boundary with regression coverage.
- `src/components/auth-form.tsx` and `auth-gateway.tsx` — validated callback destination.
- `src/app/admin/users/page.tsx`, `src/components/admin/user-role-control.tsx`, and admin user service — administrator assignment of `form_staff` and its profile.
- `src/server/production/production-job-service.ts` — add only missing safe field mutations used by the portal.
- `src/server/production/drizzle-production-job-repository.ts` — preserve current admin contract while supporting portal-safe updates.
- `src/components/admin/production-job-form.tsx`, `production-files-panel.tsx`, and `invoice-panel.tsx` — accept endpoint/navigation bases so forms can reuse mature behaviours.

---

### Task 1: Lock source parity into a typed manifest

**Files:**
- Create: `src/domain/forms/forms-parity.ts`
- Test: `src/domain/forms/forms-parity.test.ts`
- Create: `docs/audits/forms-portal-parity-matrix-2026-08-05.md`

**Interfaces:**
- Produces: `FORM_LIST_COLUMNS`, `FORM_OPTION_SETS`, `FORM_STAT_WIDGET_TYPES`, `FormListColumnKey`, `FormInlineFieldKey`.
- Consumes: no application runtime.

- [ ] **Step 1: Write a failing manifest test for exact default columns and option values**

```ts
import { describe, expect, it } from "vitest";
import { FORM_LIST_COLUMNS, FORM_OPTION_SETS } from "./forms-parity";

describe("forms source parity", () => {
  it("preserves the source list order", () => {
    expect(FORM_LIST_COLUMNS.map((column) => column.label)).toEqual([
      "Submitted Time", "Ref No.", "Web Order No.", "Size", "Urgent?",
      "DlvryDate", "DlvryMethod", "Customer Source", "Cust.Name",
      "Assign Artist", "Artist", "File Sent", "Download",
      "Customer Notified", "Printed", "Completed", "Delivered",
      "BankRecon", "AmtOwe", "AmtPaid", "AmtPayable", "Artist's Fee",
      "Remark", "Submitted By",
    ]);
  });

  it("preserves operational option sets", () => {
    expect(FORM_OPTION_SETS.deliveryMethod).toContain("Australia Shipping");
    expect(FORM_OPTION_SETS.bankRecon).toEqual(expect.arrayContaining([
      "Arrive", "Afterpay", "ZIP PAY", "Stripe", "Wise", "Checked1",
    ]));
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npm test -- src/domain/forms/forms-parity.test.ts`

Expected: FAIL because `forms-parity.ts` does not exist.

- [ ] **Step 3: Add immutable source-parity definitions**

```ts
export const FORM_STAT_WIDGET_TYPES = [
  "bar", "pie", "line", "table", "number", "divider", "text",
] as const;

export const FORM_LIST_COLUMNS = [
  { key: "submittedAt", label: "Submitted Time", inline: false },
  { key: "reference", label: "Ref No.", inline: false },
  { key: "webOrderNumber", label: "Web Order No.", inline: false },
  { key: "size", label: "Size", inline: false },
  { key: "urgent", label: "Urgent?", inline: true },
  { key: "neededDate", label: "DlvryDate", inline: true },
  { key: "deliveryMethod", label: "DlvryMethod", inline: true },
  { key: "customerSource", label: "Customer Source", inline: true },
  { key: "customerName", label: "Cust.Name", inline: false },
  { key: "assignArtist", label: "Assign Artist", inline: true },
  { key: "artist", label: "Artist", inline: true },
  { key: "fileSent", label: "File Sent", inline: true },
  { key: "downloaded", label: "Download", inline: true },
  { key: "customerNotified", label: "Customer Notified", inline: true },
  { key: "printed", label: "Printed", inline: true },
  { key: "completed", label: "Completed", inline: true },
  { key: "delivered", label: "Delivered", inline: true },
  { key: "bankRecon", label: "BankRecon", inline: true, finance: true },
  { key: "amountOwing", label: "AmtOwe", inline: false, finance: true },
  { key: "amountPaid", label: "AmtPaid", inline: true, finance: true },
  { key: "amountPayable", label: "AmtPayable", inline: true, finance: true },
  { key: "artistFee", label: "Artist's Fee", inline: true, finance: true },
  { key: "remark", label: "Remark", inline: true },
  { key: "submittedBy", label: "Submitted By", inline: false },
] as const;
```

Add the complete source option sets and annotate each row in the parity matrix with source file, Next.js owner and acceptance status.

- [ ] **Step 4: Run the manifest test**

Run: `npm test -- src/domain/forms/forms-parity.test.ts`

Expected: PASS.

- [ ] **Step 5: Check the manifest against the local plugin**

Run: `rg -n "Web Order No|Customer Source|Assign Artist|BankRecon|AmtOwe|Submitted By" /Users/ronnieli/Documents/表单/rr-gallery-order-manager/includes/class-form-fields.php`

Expected: every manifest label has an identified source definition.

### Task 2: Add form-only role and capability enforcement

**Files:**
- Modify: `src/server/db/schema/auth.ts`
- Modify: `src/server/db/schema/production.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/forms/forms-permissions.ts`
- Create: `src/server/forms/forms-permissions.test.ts`
- Create: `src/server/forms/require-forms.ts`
- Create: `src/server/forms/require-forms.test.ts`
- Modify: `src/server/admin/admin-user-service.ts`
- Modify: `src/components/admin/user-role-control.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Create: next generated Drizzle migration and snapshot after the current latest migration.

**Interfaces:**
- Produces: `FormPermission`, `FormAccess`, `hasFormPermission(role, profile, permission)`, `requireFormPermission(permission)`.
- `FormAccessProfile`: persisted booleans for view/create/edit jobs, customer contact, finance, files, proof, export, stats, saved views and assigned-only.

- [ ] **Step 1: Write failing permission tests**

```ts
expect(hasFormPermission("admin", null, "view_jobs")).toBe(true);
expect(hasFormPermission("form_staff", readOnlyProfile, "view_jobs")).toBe(true);
expect(hasFormPermission("form_staff", readOnlyProfile, "update_jobs")).toBe(false);
expect(hasFormPermission("customer", null, "view_jobs")).toBe(false);
expect(isAdminRole("form_staff")).toBe(false);
```

- [ ] **Step 2: Run the permission tests and confirm failure**

Run: `npm test -- src/server/forms/forms-permissions.test.ts src/server/auth/admin-permissions.test.ts`

Expected: FAIL because form permissions and the role do not exist.

- [ ] **Step 3: Add the role and access table additively**

Extend the user role type/check to `customer | form_staff | staff | admin`. Add `form_user_access` keyed by `user_id` with explicit boolean columns and timestamps. Define four administrator-applied presets—Manager, Artist, Finance and Read only—but persist the resulting booleans so enforcement never depends on a UI label.

```ts
export type FormPermission =
  | "access_forms" | "view_jobs" | "create_jobs" | "update_jobs"
  | "view_customer_contact" | "view_finance" | "update_finance"
  | "view_files" | "upload_files" | "delete_files"
  | "view_stats" | "manage_stats" | "export_jobs" | "manage_views";

export type FormAccessProfile = Readonly<Record<FormPermission, boolean> & {
  assignedOnly: boolean;
}>;
```

Admin receives every capability. `form_staff` receives only persisted capabilities. `staff` keeps its current `/admin` permissions and may enter `/forms` using a safe default profile without changing existing admin behaviour. Customer access is denied.

- [ ] **Step 4: Update administrator role assignment**

Allow `form_staff` in validation, audit output, user filtering and role controls. When applying `form_staff`, require a named preset and persist its capability snapshot in the same transaction. Prevent self-demotion exactly as today.

- [ ] **Step 5: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: one additive migration that expands `user_role_valid` and creates `form_user_access`; no dropped production/order/invoice tables or columns.

- [ ] **Step 6: Run schema, auth, user and permission tests**

Run: `npm test -- src/server/db/schema/admin-schema.test.ts src/server/forms/forms-permissions.test.ts src/server/forms/require-forms.test.ts src/server/auth/admin-permissions.test.ts src/server/admin/admin-user-service.test.ts src/app/api/admin/users/[userId]/route.test.ts`

Expected: PASS.

### Task 3: Make staff sign-in return safely to `/forms`

**Files:**
- Modify: `src/components/auth-form.tsx`
- Modify: `src/components/auth-form.test.tsx`
- Modify: `src/components/auth-gateway.tsx`
- Modify: `src/components/auth-gateway.test.tsx`
- Create: `src/server/auth/safe-return-path.ts`
- Create: `src/server/auth/safe-return-path.test.ts`
- Create: `src/server/forms/require-forms-page.ts`
- Create: `src/server/forms/require-forms-page.test.ts`
- Create: `src/app/forms/sign-in/page.tsx`

**Interfaces:**
- Produces: `safeAuthReturnPath(value, fallback)`, `<AuthForm returnTo />`, `<AuthGateway returnTo audience />`, `requireFormsPage(path, permission)`.

- [ ] **Step 1: Write failing redirect-security and component tests**

```ts
expect(safeAuthReturnPath("/forms?urgent=yes", "/account")).toBe("/forms?urgent=yes");
expect(safeAuthReturnPath("//evil.example", "/account")).toBe("/account");
expect(safeAuthReturnPath("https://evil.example/forms", "/account")).toBe("/account");
```

Assert password sign-in calls `router.replace("/forms")` and social sign-in uses `callbackURL: "/forms"` when `returnTo="/forms"`.

- [ ] **Step 2: Run tests and confirm the current `/account` hard-code fails**

Run: `npm test -- src/server/auth/safe-return-path.test.ts src/components/auth-form.test.tsx src/components/auth-gateway.test.tsx`

Expected: FAIL with the existing `/account` destination.

- [ ] **Step 3: Implement one validated destination contract**

`safeAuthReturnPath` accepts only same-origin absolute paths beginning `/account`, `/admin` or `/forms`, rejects `//`, backslashes and encoded control characters, and returns the supplied fallback otherwise. Pass the validated value to both email and social paths.

- [ ] **Step 4: Add form page gating and staff sign-in presentation**

`requireFormsPage` redirects unauthenticated users to `/forms/sign-in?next=<encoded>`, redirects authenticated unauthorised users to `/account`, and preserves 500 errors. The sign-in page uses the existing provider configuration and auth controls with form-operator copy; it does not provide self-registration into a staff role.

- [ ] **Step 5: Run auth and page-gate tests**

Run: `npm test -- src/server/auth/safe-return-path.test.ts src/server/forms/require-forms-page.test.ts src/components/auth-form.test.tsx src/components/auth-gateway.test.tsx src/server/auth/require-admin-page.test.ts`

Expected: PASS, including unchanged admin redirect behaviour.

### Task 4: Build the form shell and read-only source-parity workbench

**Files:**
- Create: `src/components/forms/forms-shell.tsx`
- Create: `src/components/forms/forms-shell.test.tsx`
- Create: `src/components/forms/forms.module.css`
- Create: `src/app/forms/layout.tsx`
- Create: `src/app/forms/(portal)/layout.tsx`
- Create: `src/app/forms/(portal)/page.tsx`
- Create: `src/server/forms/forms-workbench-service.ts`
- Create: `src/server/forms/forms-workbench-service.test.ts`
- Create: `src/server/forms/drizzle-forms-workbench-repository.ts`
- Create: `src/server/forms/drizzle-forms-workbench-repository.integration.test.ts`

**Interfaces:**
- Produces: `FormWorkbenchQuery`, `FormOrderRow`, `FormWorkbenchResult`, `parseFormWorkbenchQuery(input)`, `listFormOrders(database, query, access)`.
- Consumes: parity manifest and `FormAccess` from Tasks 1–2.

- [ ] **Step 1: Write failing query parser tests**

Cover quick search, page sizes 20/50/100, bounded page, default latest submission sort, date presets and rejection of unknown sort/filter fields.

```ts
expect(parseFormWorkbenchQuery({ perPage: "100", page: "2" })).toMatchObject({
  page: 2, pageSize: 100, match: "and",
});
expect(parseFormWorkbenchQuery({ perPage: "5000" }).pageSize).toBe(100);
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `npm test -- src/server/forms/forms-workbench-service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement the portal read model**

Return every default list value, including milestone booleans, reconciliation, creator name, remark, web order number, joined sizes, artist and version timestamp. Apply `assignedOnly`, customer-contact and finance projections before returning data. Do not select protected columns for users who cannot view them.

```ts
export type FormOrderRow = Readonly<{
  id: string;
  version: string;
  submittedAt: string;
  reference: string;
  webOrderNumber: string;
  size: string;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: string;
  customerSource: string;
  customerName: string;
  assignedUserId: string | null;
  artistName: string;
  milestones: Readonly<Record<"fileSent" | "downloaded" | "customerNotified" | "printed" | "completed" | "delivered", boolean>>;
  bankRecon: string | null;
  finance: null | Readonly<{ amountOwingCents: number; amountPaidCents: number; amountPayableCents: number; artistFeeCents: number | null }>;
  remark: string;
  submittedBy: string;
}>;
```

- [ ] **Step 4: Build the shell and server-rendered list entry**

Header must contain Data list, Custom stats when permitted, current operator, Log out and Order entry when permitted. The layout excludes storefront header/footer and admin sidebar.

- [ ] **Step 5: Run shell, service and repository tests**

Run: `npm test -- src/components/forms/forms-shell.test.tsx src/server/forms/forms-workbench-service.test.ts src/server/forms/drizzle-forms-workbench-repository.integration.test.ts`

Expected: PASS with finance/contact redaction and assigned-only scoping verified.

### Task 5: Add advanced filtering, saved views and list API

**Files:**
- Create: `src/app/api/forms/jobs/route.ts`
- Create: `src/app/api/forms/jobs/route.test.ts`
- Create: `src/app/api/forms/jobs/export/route.ts`
- Create: `src/app/api/forms/jobs/export/route.test.ts`
- Create: `src/app/api/forms/views/route.ts`
- Create: `src/app/api/forms/views/[viewId]/route.ts`
- Create: `src/app/api/forms/views/route.test.ts`
- Create: `src/app/api/forms/views/[viewId]/route.test.ts`
- Create: `src/components/forms/forms-filter-builder.tsx`
- Create: `src/components/forms/forms-filter-builder.test.tsx`
- Create: `src/components/forms/forms-workbench.tsx`
- Reuse/extend: `src/server/production/production-saved-view-service.ts`

**Interfaces:**
- Produces: `FormFilterCondition`, `FormFilterGroup`, protected GET/POST list endpoint, saved-view CRUD.
- Consumes: `parseFormWorkbenchQuery`, current production saved-view repository and form permission gate.

- [ ] **Step 1: Write failing filter allowlist tests**

```ts
expect(parseFormFilterGroup({
  match: "or",
  conditions: [
    { field: "urgent", operator: "equals", value: "true" },
    { field: "neededDate", operator: "between", value: ["2026-08-01", "2026-08-31"] },
  ],
}).conditions).toHaveLength(2);
expect(() => parseFormFilterGroup({ match: "and", conditions: [
  { field: "raw_sql", operator: "equals", value: "1=1" },
] })).toThrow();
```

- [ ] **Step 2: Run filter and route tests and confirm failure**

Run: `npm test -- src/components/forms/forms-filter-builder.test.tsx src/app/api/forms/jobs/route.test.ts`

Expected: FAIL because forms filters and routes are absent.

- [ ] **Step 3: Implement AND/OR filter validation and query compilation**

Allow only manifest-backed fields and compatible operators. Cap conditions at 20, search length at 190, saved query length at 2,000 and result page size at 100. Support All data, last six months and last year as deterministic query presets.

- [ ] **Step 4: Implement saved-view API on the existing table**

Scope personal views to the actor. Keep create/delete auditing and trusted same-origin mutation checks. A form operator cannot read or delete another operator's saved view.

- [ ] **Step 5: Add protected filtered CSV export**

Reuse the current production export service with the validated form filters, assigned-only scope, field visibility and finance/customer permissions. Prefix spreadsheet-formula characters in text cells and audit every export. A user without `export_jobs` receives 403 before a query runs.

- [ ] **Step 6: Build accessible filter and saved-view controls**

The filter popover has field, operator and value controls; explicit Apply, Reset and Save actions; visible active-filter count; and keyboard Escape close with focus restoration. URL state remains shareable without containing sensitive values.

- [ ] **Step 7: Run route, service and component tests**

Run: `npm test -- src/app/api/forms/jobs/route.test.ts src/app/api/forms/jobs/export/route.test.ts src/app/api/forms/views/route.test.ts src/server/production/production-saved-view-service.test.ts src/components/forms/forms-filter-builder.test.tsx`

Expected: PASS.

### Task 6: Build the dense desktop table and mobile cards

**Files:**
- Create: `src/components/forms/forms-order-table.tsx`
- Create: `src/components/forms/forms-order-table.test.tsx`
- Create: `src/components/forms/forms-order-cards.tsx`
- Create: `src/components/forms/forms-order-cards.test.tsx`
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms.module.css`

**Interfaces:**
- Produces: `<FormsOrderTable rows columns onOpen />`, `<FormsOrderCards rows onOpen />`.
- Consumes: `FormOrderRow`, role-visible manifest columns.

- [ ] **Step 1: Write failing rendering tests**

Assert the desktop table follows all 24 labels, hides finance cells without permission, links a reference to the drawer, formats cents/dates, and renders stable YES/NO/status chips. Assert mobile cards expose reference, customer, size, urgency, payable/owing, delivery and next production state.

- [ ] **Step 2: Run component tests and confirm failure**

Run: `npm test -- src/components/forms/forms-order-table.test.tsx src/components/forms/forms-order-cards.test.tsx`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement semantic table and card rendering**

Use a real `<table>` with sticky `<thead>`, stable `min-width` per column and a labelled scroll region. Preserve high density with readable 12–14px operational text, not the source screenshot's smallest text. Status colour is never the only signal.

- [ ] **Step 4: Add responsive behaviour**

At narrow widths render cards instead of hiding half the table. Avoid duplicate interactive DOM by switching with a server-safe CSS/media strategy or a single hydrated viewport state with an accessible fallback. The page itself must not overflow horizontally; only the desktop table region may scroll.

- [ ] **Step 5: Run component and accessibility assertions**

Run: `npm test -- src/components/forms/forms-order-table.test.tsx src/components/forms/forms-order-cards.test.tsx src/components/forms/forms-shell.test.tsx`

Expected: PASS.

### Task 7: Add audited inline editing with conflict recovery

**Files:**
- Create: `src/components/forms/forms-inline-cell.tsx`
- Create: `src/components/forms/forms-inline-cell.test.tsx`
- Create: `src/app/api/forms/jobs/[jobId]/route.ts`
- Create: `src/app/api/forms/jobs/[jobId]/route.test.ts`
- Modify: `src/server/production/production-job-service.ts`
- Modify: `src/server/production/production-job-service.test.ts`
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Modify: `src/components/forms/forms-order-table.tsx`

**Interfaces:**
- Produces: `FormInlinePatch = { field, value, expectedUpdatedAt, idempotencyKey }`, `<FormsInlineCell />`.
- Consumes: existing `updateProductionJob`, form permission gate and manifest inline metadata.

- [ ] **Step 1: Write failing route tests for permissions, authority and conflict**

Cover no update permission, cross-origin mutation, manual amount update without finance permission, attempted web-total update, valid milestone update and stale `expectedUpdatedAt` returning 409.

- [ ] **Step 2: Run route/service tests and confirm failure**

Run: `npm test -- src/app/api/forms/jobs/[jobId]/route.test.ts src/server/production/production-job-service.test.ts`

Expected: FAIL because the form patch envelope is unavailable.

- [ ] **Step 3: Map each inline field to one existing typed mutation**

```ts
const INLINE_PATCHES = {
  urgent: (value: boolean) => ({ urgent: value }),
  neededDate: (value: string) => ({ neededDate: value }),
  deliveryMethod: (value: string) => ({ deliveryMethod: value }),
  fileSent: (value: boolean) => ({ milestones: { fileSent: value } }),
  downloaded: (value: boolean) => ({ milestones: { downloaded: value } }),
  customerNotified: (value: boolean) => ({ milestones: { customerNotified: value } }),
  printed: (value: boolean) => ({ milestones: { printed: value } }),
  completed: (value: boolean) => ({ milestones: { completed: value } }),
  delivered: (value: boolean) => ({ milestones: { delivered: value } }),
} as const;
```

Add mappings for assignee, reconciliation, remark/custom-field value and manual-only finance. Reject fields absent from the manifest. Never translate web total edits into order mutations.

- [ ] **Step 4: Build inline cell states**

The cell shows idle, Saving, Saved and Error states. On 409 it restores the prior visible value and offers `Reload row`; on validation/permission failure it restores the value and announces the server message via `aria-live`.

- [ ] **Step 5: Run route, service, repository and component tests**

Run: `npm test -- src/app/api/forms/jobs/[jobId]/route.test.ts src/server/production/production-job-service.test.ts src/components/forms/forms-inline-cell.test.tsx`

Expected: PASS with one audit event per accepted mutation.

### Task 8: Build manual entry, detail editor and resizable drawer

**Files:**
- Create: `src/components/forms/forms-job-drawer.tsx`
- Create: `src/components/forms/forms-job-drawer.test.tsx`
- Create: `src/components/forms/forms-job-editor.tsx`
- Create: `src/components/forms/forms-job-editor.test.tsx`
- Create: `src/app/forms/(portal)/new/page.tsx`
- Create: `src/app/forms/(portal)/jobs/[jobId]/page.tsx`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/components/admin/production-job-form.test.tsx`
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/app/api/forms/jobs/route.ts`
- Modify: `src/app/api/forms/jobs/[jobId]/route.ts`

**Interfaces:**
- Produces: `<FormsJobDrawer jobId mode onClose />`, `<FormsJobEditor mode endpoint returnTo />`.
- Consumes: current production create/update services, form permissions, files and invoice panels.

- [ ] **Step 1: Write failing create/detail and unsaved-change tests**

Assert manual creation includes every active source field, uses a client idempotency key, returns the new reference, and redirects to `/forms/jobs/<id>`. Assert closing a dirty drawer requires confirmation and a clean drawer closes immediately.

- [ ] **Step 2: Run component and route tests and confirm failure**

Run: `npm test -- src/components/forms/forms-job-drawer.test.tsx src/components/forms/forms-job-editor.test.tsx src/app/api/forms/jobs/route.test.ts`

Expected: FAIL because the forms editor is absent.

- [ ] **Step 3: Parameterise mature shared form behaviour**

Add optional defaults to `ProductionJobForm`:

```ts
type ProductionJobFormProps = {
  endpoint?: string;
  afterCreate?: (job: { id: string; jobNumber: string }) => void;
  // existing assignee, finance, product and custom-field props remain unchanged
};
```

The existing admin page continues using `/api/admin/jobs` and `/admin/jobs/<id>`. The forms editor uses `/api/forms/jobs` and its drawer/full-page navigation. Do not duplicate calculation or payload construction.

- [ ] **Step 4: Build grouped parity editor**

Expose Order, Product, Delivery, Customer, Design, Production, Payment, Finance, Files, Invoice and collapsed Legacy history. Hide fields by server-provided capabilities. Keep web financial/order fields visibly read-only with an authority explanation.

- [ ] **Step 5: Implement drawer mechanics**

Use a modal dialog with focus trap, Escape handling, focus restoration, 520–900px resizable desktop width and full-screen mobile presentation. Persist drawer width locally without storing customer data. Direct route is the refresh/deep-link fallback.

- [ ] **Step 6: Run create/detail/drawer and existing admin regressions**

Run: `npm test -- src/components/forms/forms-job-drawer.test.tsx src/components/forms/forms-job-editor.test.tsx src/components/admin/production-job-form.test.tsx src/app/admin/jobs/new/page.test.tsx src/app/admin/jobs/[jobId]/page.test.tsx`

Expected: PASS.

### Task 9: Reuse private files, proof and invoice workflows in `/forms`

**Files:**
- Modify: `src/components/admin/production-files-panel.tsx`
- Modify: `src/components/admin/production-files-panel.test.tsx`
- Modify: `src/components/admin/invoice-panel.tsx`
- Modify: `src/components/admin/invoice-panel.test.tsx`
- Create: `src/app/api/forms/jobs/[jobId]/files/route.ts`
- Create: `src/app/api/forms/jobs/[jobId]/files/[fileId]/route.ts`
- Create: `src/app/api/forms/jobs/[jobId]/files/route.test.ts`
- Create: `src/app/api/forms/jobs/[jobId]/files/[fileId]/route.test.ts`
- Create: `src/app/api/forms/jobs/[jobId]/proof-reviews/route.ts`
- Create: `src/app/api/forms/jobs/[jobId]/proof-reviews/route.test.ts`
- Create: `src/app/api/forms/jobs/[jobId]/invoice/route.ts`
- Create: `src/app/api/forms/invoices/[invoiceId]/pdf/route.ts`
- Create: `src/app/api/forms/jobs/[jobId]/invoice/route.test.ts`
- Create: `src/app/api/forms/invoices/[invoiceId]/pdf/route.test.ts`
- Modify: `src/components/forms/forms-job-editor.tsx`

**Interfaces:**
- Produces: reusable `apiBasePath`/`pdfBasePath` component configuration and form-protected adapters.
- Consumes: existing production proof, private upload and invoice runtimes.

- [ ] **Step 1: Write failing endpoint-parameter and permission tests**

Assert panels call `/api/forms/...` when configured and retain `/api/admin/...` by default. Route tests cover view/upload/delete, finance/PDF permission, same-origin mutation, immutable invoice and audit behaviour.

- [ ] **Step 2: Run targeted tests and confirm hard-coded admin paths fail**

Run: `npm test -- src/components/admin/production-files-panel.test.tsx src/components/admin/invoice-panel.test.tsx src/app/api/forms/jobs/[jobId]/files/route.test.ts src/app/api/forms/jobs/[jobId]/invoice/route.test.ts`

Expected: FAIL on missing form routes and configurable paths.

- [ ] **Step 3: Parameterise components without changing defaults**

```ts
type EndpointProps = Readonly<{
  jobApiBase?: string;
  invoicePdfBase?: string;
}>;
```

Default values preserve all current admin URLs. The forms editor supplies its protected endpoints.

- [ ] **Step 4: Implement thin protected route adapters**

Each forms route obtains `FormAccess`, checks the exact capability, performs trusted-origin checks for mutations and invokes the existing runtime method. It must not copy invoice math, upload validation or file-storage logic.

- [ ] **Step 5: Run existing and new file/invoice suites**

Run: `npm test -- src/components/admin/production-files-panel.test.tsx src/components/admin/invoice-panel.test.tsx src/app/api/admin/jobs/[jobId]/files/route.test.ts src/app/api/admin/jobs/[jobId]/invoice/route.test.ts src/app/api/forms/jobs/[jobId]/files/route.test.ts src/app/api/forms/jobs/[jobId]/invoice/route.test.ts src/server/invoices/invoice-service.test.ts`

Expected: PASS.

### Task 10: Add Column stats and custom statistics layouts

**Files:**
- Modify: `src/server/db/schema/production.ts`
- Create: generated additive migration/snapshot if Task 2 migration does not already contain this table.
- Create: `src/server/forms/forms-stats-service.ts`
- Create: `src/server/forms/forms-stats-service.test.ts`
- Create: `src/server/forms/drizzle-forms-stats-repository.ts`
- Create: `src/server/forms/drizzle-forms-stats-repository.integration.test.ts`
- Create: `src/app/api/forms/stats/route.ts`
- Create: `src/app/api/forms/stats/layout/route.ts`
- Create: `src/app/api/forms/stats/route.test.ts`
- Create: `src/app/api/forms/stats/layout/route.test.ts`
- Create: `src/components/forms/forms-stats-workbench.tsx`
- Create: `src/components/forms/forms-stats-workbench.test.tsx`
- Create: `src/app/forms/(portal)/stats/page.tsx`

**Interfaces:**
- Produces: `FormStatWidget`, `FormStatsLayout`, `queryFormStatistic(actor, filter, widget)`.
- Consumes: parity widget types, filter parser and form permissions.

- [ ] **Step 1: Write failing validation and permission tests**

```ts
expect(parseFormStatsLayout({ name: "Daily", widgets: [
  { id: "w1", type: "number", metric: "job_count", title: "Orders" },
] }).widgets).toHaveLength(1);
expect(() => parseFormStatsLayout({ name: "Unsafe", widgets: [
  { id: "w1", type: "number", metric: "select * from user", title: "Leak" },
] })).toThrow();
```

Test that finance metrics are rejected before query execution for users without `view_finance`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/server/forms/forms-stats-service.test.ts src/components/forms/forms-stats-workbench.test.tsx`

Expected: FAIL because stats services/components are absent.

- [ ] **Step 3: Add saved layout persistence**

Add `form_stats_layouts` with `user_id`, name, validated widgets JSON, timestamps and one user/name unique constraint. Widgets are limited to 24 and payload to 50KB. No executable expressions are stored.

- [ ] **Step 4: Implement bounded aggregate registry**

Allow explicit metrics such as job count, urgent count, delivery-method count, status count, customer-source count, amount payable/paid/owing totals and daily/monthly count series. Reuse the active list filters and assigned-only scope. Cap series length and category cardinality.

- [ ] **Step 5: Build Column stats and Custom stats editor**

Support bar, pie, line, table, number, divider and text widgets; add/configure/preview/reorder/remove; save feedback; keyboard reordering controls in addition to pointer drag. Render an accessible data table or text equivalent for every chart.

- [ ] **Step 6: Generate/inspect migration and run tests**

Run: `npm run db:generate`

Expected: only the new stats-layout table/indexes when not included in Task 2's migration.

Run: `npm test -- src/server/forms/forms-stats-service.test.ts src/server/forms/drizzle-forms-stats-repository.integration.test.ts src/app/api/forms/stats/route.test.ts src/components/forms/forms-stats-workbench.test.tsx`

Expected: PASS.

### Task 11: Complete portal integration, failure states and parity coverage

**Files:**
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms.module.css`
- Create: `src/app/forms/(portal)/loading.tsx`
- Create: `src/app/forms/(portal)/error.tsx`
- Create: `src/app/forms/(portal)/not-found.tsx`
- Create: `src/app/forms/forms-pages.test.tsx`
- Modify: `docs/audits/forms-portal-parity-matrix-2026-08-05.md`

**Interfaces:**
- Produces: completed navigation flow and signed parity matrix.
- Consumes: all earlier portal interfaces.

- [ ] **Step 1: Write failing end-to-end component/page-flow tests**

Cover sign-in return, empty list, zero-result filter, list refresh, row open/close, dirty drawer, create success/error, inline conflict, file failure, invoice failure, stats permission, mobile card navigation and logout.

- [ ] **Step 2: Run the integration-focused tests and record failures**

Run: `npm test -- src/app/forms/forms-pages.test.tsx src/components/forms`

Expected: FAIL on the first unconnected state while all previously completed component tests remain green. Record each failing assertion before changing its owning component.

- [ ] **Step 3: Connect remaining states with explicit UI**

Add skeleton/loading messages, retry actions, empty-state reset, not-found return to Data list, field-level errors, network interruption feedback and conflict reload. No error state may erase unsaved form input.

- [ ] **Step 4: Complete the parity matrix**

For each source screen, field, option, status and action, record the source location, Next.js implementation path, automated test and manual browser result. An unchecked row blocks completion.

- [ ] **Step 5: Run portal and affected admin regression tests**

Run: `npm test -- src/domain/forms src/server/forms src/components/forms src/app/forms src/app/api/forms src/server/auth src/components/auth-form.test.tsx src/components/auth-gateway.test.tsx src/app/admin/jobs src/components/admin/production-job-form.test.tsx src/components/admin/production-files-panel.test.tsx src/components/admin/invoice-panel.test.tsx`

Expected: PASS.

### Task 12: Database, full-suite and real-browser production verification

**Files:**
- Modify when verification exposes an owned defect: `src/app/forms/**`, `src/app/api/forms/**`, `src/components/forms/**`, `src/server/forms/**`
- Modify only when an affected regression is proved: the shared auth, production, file or invoice files listed in Tasks 2–9
- Create: `docs/audits/forms-portal-real-browser-2026-08-05/README.md`
- Create: browser screenshots under `docs/audits/forms-portal-real-browser-2026-08-05/`.

**Interfaces:**
- Produces: final evidence pack and production-readiness result.
- Consumes: completed portal and parity matrix.

- [ ] **Step 1: Verify migration integrity**

Run: `npm run db:check`

Expected: PASS with no destructive schema changes.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run the complete automated suite**

Run: `npm run test:run`

Expected: all tests PASS; no skipped portal parity tests.

- [ ] **Step 4: Run a production build**

Run: `npm run build`

Expected: PASS with `/forms`, `/forms/jobs/[jobId]`, `/forms/stats` and protected API routes present.

- [ ] **Step 5: Verify real role journeys on the official local origin**

At `http://192.168.4.199:3000`, verify admin, Manager-form staff, Artist assigned-only, Finance and Read-only profiles. Confirm forbidden APIs return 403 and unrelated `/admin` routes remain unavailable to `form_staff`.

- [ ] **Step 6: Verify complete desktop workflow**

At 1440px and 1920px: sign in, search, build AND/OR filters, save/apply/delete a view, page at 20/50/100, inline-edit every allowed field, recover a simulated conflict, open/resize/close the drawer, protect dirty input, create a manual job, inspect a linked web job, upload/preview/delete a permitted test file, draft/issue/download a test invoice and configure every stats widget type.

- [ ] **Step 7: Verify tablet and mobile workflows**

At 768px, 430px and 390px: confirm no page overflow/overlap/clipping, mobile cards expose essential values, filters are usable, full-page create/edit works, files and invoice remain reachable, focus is visible and tap targets are practical.

- [ ] **Step 8: Verify web-order integrity**

Create one test checkout through the current storefront and confirm exactly one production row appears with the correct product, size, customer, total, payment state and address. Refresh/retry must not duplicate it. Confirm a manual job has no ecommerce order record.

- [ ] **Step 9: Verify failure and console evidence**

Confirm loading, empty, 401, 403, 404, 409, validation, upload and network failure states. Record zero unhandled browser console errors and zero failed portal requests outside deliberately tested failures.

- [ ] **Step 10: Final repository checks**

Run: `git diff --check`

Expected: PASS.

Run: `git status --short`

Expected: only the pre-existing work plus intentional forms portal, tests, migrations and audit evidence; no source plugin changes and no commit.

---

## Completion boundary

Do not report the forms portal complete merely because `/forms` renders. Completion requires every Task 12 check and every row in `docs/audits/forms-portal-parity-matrix-2026-08-05.md` to pass. Any unavailable external provider credential is reported separately and must not be disguised as a successful integration.
