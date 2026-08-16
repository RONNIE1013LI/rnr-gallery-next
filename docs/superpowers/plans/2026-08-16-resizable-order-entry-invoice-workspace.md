# Resizable Order Entry and Invoice Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Forms Data list visible while a manual order is entered in a right-side resizable drawer, and make the invoice editor/preview workspace resizable on desktop and practical on mobile.

**Architecture:** Add one focused pointer/keyboard separator component with caller-owned width state and no persistence. Reuse it in the invoice overlay and the new order-entry drawer; keep the existing full `/order-system/new` page as a protected fallback. The Data list route owns drawer visibility through an `entry=new` query parameter so filters, sorting, pagination, and the list component remain mounted.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Desktop order entry leaves at least 280px of the Data list visible; a 390px viewport leaves 20px.
- Invoice editor width is clamped to 320–720px and the preview remains usable.
- Width state is in memory only and resets when its drawer/workspace closes.
- At 900px or below the invoice uses `Edit invoice` / `Preview invoice` controls with 44px minimum touch targets.
- Direct `/order-system/new` remains permission protected.
- Do not change invoice calculations, GST, currencies, PDF generation, order creation, payment, authentication, or database structure.
- Do not add dependencies or persist widths in localStorage/sessionStorage/cookies.

---

## File map

- Create `src/components/shared/resizable-separator.tsx`: reusable vertical separator that translates pointer and keyboard movement into a clamped numeric width.
- Create `src/components/shared/resizable-separator.test.tsx`: separator semantics, drag, keyboard, and boundary coverage.
- Modify `src/components/admin/invoice-workspace.tsx`: owns temporary editor width and mobile active-view state.
- Modify `src/components/admin/invoice-workspace.test.tsx`: invoice resizing, mobile switching, and draft-preservation regression coverage.
- Modify `src/components/admin/admin.module.css`: desktop three-column invoice grid and mobile single-pane controls.
- Create `src/components/forms/forms-order-entry-link.tsx`: builds an `entry=new` URL from the live Data list query.
- Modify `src/components/forms/forms-shell.tsx` and `forms-shell.test.tsx`: use the query-preserving trigger.
- Create `src/components/forms/forms-order-entry-drawer.tsx` and `.test.tsx`: accessible drawer, unsaved-change guard, temporary width, and embedded `ProductionJobForm`.
- Modify `src/app/forms/(portal)/page.tsx` and `page.test.tsx`: permission-gated, conditional order-entry data loading.
- Modify `src/components/forms/forms-workbench.tsx` and `.test.tsx`: render/close the drawer without unmounting the Data list.
- Modify `src/components/forms/forms.module.css`: slide-in drawer, draggable edge, desktop and 390px size limits.

---

### Task 1: Accessible resizable separator

**Files:**
- Create: `src/components/shared/resizable-separator.tsx`
- Create: `src/components/shared/resizable-separator.test.tsx`

**Interfaces:**
- Produces: `ResizableSeparator({ label, value, min, max, step, direction, onChange, className })`.
- `direction: 1 | -1` maps positive horizontal movement to increasing or decreasing the controlled width.
- Pointer capture remains local to the separator; callers own width and lifecycle.

- [ ] **Step 1: Write failing behavior tests**

```tsx
render(<Harness initial={480} min={320} max={720} direction={1} />);
const separator = screen.getByRole("separator", { name: "Resize invoice editor" });
expect(separator).toHaveAttribute("aria-orientation", "vertical");
fireEvent.keyDown(separator, { key: "ArrowRight" });
expect(screen.getByTestId("width")).toHaveTextContent("500");
fireEvent.keyDown(separator, { key: "End" });
expect(screen.getByTestId("width")).toHaveTextContent("720");
```

Add a pointer movement case using `pointerDown` at `clientX: 500`, `pointerMove` at `clientX: 560`, and assert a 60px change. Add a `direction={-1}` case for the drawer's left edge.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/components/shared/resizable-separator.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the minimum separator**

```tsx
export function ResizableSeparator({ value, min, max, step = 20, direction, onChange, ...props }: Props) {
  const dragStart = useRef<{ x: number; value: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return <div role="separator" aria-orientation="vertical" aria-valuemin={min}
    aria-valuemax={max} aria-valuenow={value} tabIndex={0}
    onPointerDown={(event) => { dragStart.current = { x: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { if (dragStart.current) onChange(clamp(dragStart.current.value + ((event.clientX - dragStart.current.x) * direction))); }}
    onPointerUp={(event) => { dragStart.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={(event) => { /* ArrowLeft/ArrowRight/Home/End, clamp, preventDefault */ }} {...props} />;
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run src/components/shared/resizable-separator.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/resizable-separator.tsx src/components/shared/resizable-separator.test.tsx
git commit -m "feat: add accessible resizable separator"
```

---

### Task 2: Resizable invoice workspace and mobile view switch

**Files:**
- Modify: `src/components/admin/invoice-workspace.tsx`
- Modify: `src/components/admin/invoice-workspace.test.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Consumes: `ResizableSeparator` from Task 1 with `direction={1}`.
- Produces: temporary `editorWidth` defaulting to 440px and `mobileView: "edit" | "preview"` defaulting to `"edit"`.

- [ ] **Step 1: Write failing invoice behavior tests**

```tsx
const { unmount } = render(<Harness />);
const separator = screen.getByRole("separator", { name: "Resize invoice editor" });
expect(separator).toHaveAttribute("aria-valuemin", "320");
expect(separator).toHaveAttribute("aria-valuemax", "720");
fireEvent.keyDown(separator, { key: "ArrowRight" });
expect(screen.getByTestId("invoice-workspace-layout")).toHaveStyle("--invoice-editor-width: 460px");
unmount();
render(<Harness />);
expect(screen.getByRole("separator", { name: "Resize invoice editor" })).toHaveAttribute("aria-valuenow", "440");
```

Add a mobile-control test that changes `Customer Name`, clicks `Preview invoice`, clicks `Edit invoice`, and verifies the changed value remains. Assert `aria-pressed` changes and both controls exist.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/components/admin/invoice-workspace.test.tsx`

Expected: FAIL because no separator or mobile controls exist.

- [ ] **Step 3: Implement desktop and mobile layout state**

Add `editorWidth` and `mobileView` state, a two-button `.invoiceWorkspaceViewSwitch`, the separator between editor and preview, `data-mobile-view`, and a CSS variable on the layout. CSS desktop columns are `var(--invoice-editor-width) 10px minmax(480px, 1fr)`; at `max-width: 900px` hide the separator and inactive pane and show the two controls.

- [ ] **Step 4: Verify GREEN and unchanged invoice behavior**

Run: `npm test -- --run src/components/admin/invoice-workspace.test.tsx src/components/shared/resizable-separator.test.tsx src/components/admin/invoice-panel.test.tsx`

Expected: PASS, including existing live-preview and download tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/invoice-workspace.tsx src/components/admin/invoice-workspace.test.tsx src/components/admin/admin.module.css
git commit -m "feat: make invoice workspace responsive and resizable"
```

---

### Task 3: Query-preserving Order entry trigger and permission-gated data

**Files:**
- Create: `src/components/forms/forms-order-entry-link.tsx`
- Modify: `src/components/forms/forms-shell.tsx`
- Modify: `src/components/forms/forms-shell.test.tsx`
- Modify: `src/app/forms/(portal)/page.tsx`
- Modify: `src/app/forms/(portal)/page.test.tsx`

**Interfaces:**
- Produces: `FormsOrderEntryLink` that reads `usePathname()` and `useSearchParams()` and links to `/order-system?<existing>&entry=new` on the Data list, otherwise `/order-system?entry=new`.
- Produces: `OrderEntryDrawerData` containing `assignees`, `canManageFinance`, `submittedBy`, `productTitles`, `customFields`, and `invoiceBusiness` only when `entry=new` and `create_jobs` is permitted.
- The repository query receives the same operational filters; `entry` is UI-only.

- [ ] **Step 1: Write failing trigger and page tests**

```tsx
expect(screen.getByRole("link", { name: "Order entry" }))
  .toHaveAttribute("href", "/order-system?q=07188&page=2&entry=new");
```

In the page test, request `{ q: "07188", entry: "new" }`, grant `create_jobs`, and assert the rendered drawer receives active product titles and eligible fields. Add a denial case proving that `entry=new` does not load/render the form without `create_jobs`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/components/forms/forms-shell.test.tsx 'src/app/forms/(portal)/page.test.tsx'`

Expected: FAIL because the header still targets `/order-system/new` and the Data list does not prepare entry data.

- [ ] **Step 3: Implement trigger and conditional server loading**

Use a client link component to preserve Data list search parameters. In `FormsDataListPage`, compute `entryRequested`, check `create_jobs`, and only then load product registry, custom fields, invoice business, and assignees. Keep `requireFormsPage(..., "view_jobs")` and repository behavior unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run src/components/forms/forms-shell.test.tsx 'src/app/forms/(portal)/page.test.tsx' 'src/app/forms/(portal)/new/page.test.tsx'`

Expected: PASS; the fallback page remains protected by `create_jobs`.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/forms-order-entry-link.tsx src/components/forms/forms-shell.tsx src/components/forms/forms-shell.test.tsx 'src/app/forms/(portal)/page.tsx' 'src/app/forms/(portal)/page.test.tsx'
git commit -m "feat: open manual entry from data list query"
```

---

### Task 4: Resizable Order entry drawer

**Files:**
- Create: `src/components/forms/forms-order-entry-drawer.tsx`
- Create: `src/components/forms/forms-order-entry-drawer.test.tsx`
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms-workbench.test.tsx`
- Modify: `src/components/forms/forms.module.css`

**Interfaces:**
- Consumes: `OrderEntryDrawerData` from Task 3 and `ResizableSeparator` with `direction={-1}`.
- Produces: `FormsOrderEntryDrawer({ data, onClose })` with an embedded `ProductionJobForm` using `/api/forms/jobs` and `/order-system/jobs`.
- Closing removes only `entry` from the current URL; other query keys and repeated `filter` values remain unchanged.

- [ ] **Step 1: Write failing drawer tests**

```tsx
render(<FormsOrderEntryDrawer data={drawerData} onClose={onClose} />);
expect(screen.getByRole("dialog", { name: "Order entry" })).toBeInTheDocument();
const separator = screen.getByRole("separator", { name: "Resize order entry" });
expect(separator).toHaveAttribute("aria-valuenow", expect.any(String));
fireEvent.keyDown(separator, { key: "ArrowLeft" });
expect(screen.getByRole("dialog", { name: "Order entry" })).toHaveStyle("--entry-drawer-width: 740px");
```

Add tests for: close calls `onClose`; a changed form asks before closing; remount resets width; 1000px viewport clamps to 720px (leaving 280px); 390px viewport clamps to 370px (leaving 20px). In the Workbench test, close the drawer and assert `router.replace("/order-system?q=07188&page=2")` while the table stays rendered.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.test.tsx`

Expected: FAIL because the drawer and integration do not exist.

- [ ] **Step 3: Implement drawer, integration, and responsive CSS**

Use `useContainedDialog`, an initial close-button ref, and `onChangeCapture` to mark the embedded form dirty. Calculate limits from `window.innerWidth` on mount and resize: desktop `max = innerWidth - 280`, mobile `max = innerWidth - 20`; choose a safe minimum not greater than `max`, and default to `min(max, round(innerWidth * 0.72))`. Keep state inside the drawer session so close/reopen resets it. Add a short right-to-left transform animation and a 10px draggable left edge without changing the existing saved-order drawer.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.test.tsx src/components/forms/forms-job-drawer.test.tsx`

Expected: PASS; existing saved-order drawer behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/forms-order-entry-drawer.tsx src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.tsx src/components/forms/forms-workbench.test.tsx src/components/forms/forms.module.css
git commit -m "feat: add resizable manual order drawer"
```

---

### Task 5: Regression and browser verification

**Files:**
- Modify only if a concrete test or browser failure identifies an in-scope defect.

**Interfaces:**
- Consumes all earlier tasks; produces no new behavior.

- [ ] **Step 1: Run focused and static checks**

```bash
npm test -- --run src/components/shared/resizable-separator.test.tsx src/components/admin/invoice-workspace.test.tsx src/components/admin/invoice-panel.test.tsx src/components/forms/forms-shell.test.tsx src/components/forms/forms-order-entry-drawer.test.tsx src/components/forms/forms-workbench.test.tsx src/components/forms/forms-job-drawer.test.tsx 'src/app/forms/(portal)/page.test.tsx' 'src/app/forms/(portal)/new/page.test.tsx'
npm run lint
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 2: Run broader non-database unit suite and build**

```bash
npm test -- --run --exclude '**/*.integration.test.ts' --exclude 'src/server/addresses/drizzle-address-repository.test.ts' --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'
BETTER_AUTH_URL=https://build.local.invalid BETTER_AUTH_SECRET='build-only-secret-with-32-characters' DATABASE_URL='postgresql://build:build@127.0.0.1:65432/build' RNR_PRIVATE_UPLOAD_DIR='/tmp/rnr-codex-build-uploads' npm run build
```

Expected: PASS. Never print or load production secrets.

- [ ] **Step 3: Verify local desktop and 390px flows**

At `http://192.168.4.199:3000/order-system`, confirm: Data list remains visible behind Order entry; drag/keyboard resizing respects the 280px desktop remainder; close preserves filters; reopen resets width; invoice desktop split resizes; at 390px the drawer leaves 20px and invoice toggles preserve edits; neither view creates horizontal overflow.

- [ ] **Step 4: Fix only evidence-backed failures and rerun their checks**

For each failure, add or adjust a failing regression test first, then make the smallest correction and rerun the exact failed command.

- [ ] **Step 5: Final commit if verification required an in-scope fix**

```bash
git add <only-the-files-changed-for-the-verified-fix>
git commit -m "fix: complete resizable order entry verification"
```
