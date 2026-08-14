# Forms Inline Select Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inline select and boolean fields save immediately after a changed selection without rendering confirm or cancel buttons.

**Architecture:** Keep the existing `FormsInlineCell` state, PATCH endpoint, concurrency version and idempotency key. Add an optional value argument to the existing save path so a select change can submit the event value immediately, while text, date and money editors continue using the existing draft plus explicit buttons.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Next.js 16.

## Global Constraints

- Apply autosave only to inline `select` and `boolean` fields.
- Keep text, date and money editors on the existing explicit save/cancel workflow.
- Preserve current field values, colours, permissions, PATCH endpoint, optimistic concurrency and idempotency handling.
- Do not change database, API contracts, authentication, roles or table layout.
- Do not create a Git commit.

---

### Task 1: Autosave inline dropdown fields

**Files:**
- Modify: `src/components/forms/forms-inline-cell.tsx`
- Test: `src/components/forms/forms-inline-cell.test.tsx`

**Interfaces:**
- Consumes: the existing `FormsInlineCell` props and `PATCH /api/forms/jobs/:jobId` payload.
- Produces: unchanged public component props; select and boolean editors call the existing save operation on changed selection.

- [ ] **Step 1: Write failing dropdown autosave tests**

Add tests that activate a select or boolean cell, change its value, and assert that the real rendered component:

```tsx
fireEvent.click(screen.getByRole("button", { name: "Edit Printed for 07188" }));
fireEvent.change(screen.getByLabelText("Printed for 07188"), {
  target: { value: "true" },
});

await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
expect(screen.queryByRole("button", { name: "Save Printed" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Cancel Printed" })).not.toBeInTheDocument();
```

Also cover a normal select field, unchanged selection, and failed-save restoration. The production change these tests catch is reintroducing manual confirmation or submitting stale draft state.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/components/forms/forms-inline-cell.test.tsx
```

Expected: the new tests fail because changing a dropdown currently only updates `draft`, and save/cancel buttons are still rendered.

- [ ] **Step 3: Implement minimal dropdown autosave**

In `FormsInlineCell`:

```tsx
async function save(nextDraft = draft) {
  // Existing request and recovery logic, using nextDraft for requestValue.
}

function changeSelect(nextDraft: string) {
  setDraft(nextDraft);
  if (nextDraft !== original) void save(nextDraft);
}
```

Use `changeSelect` for `select` and `boolean` `onChange`. Render save/cancel buttons only for text, date and money kinds. Keep the existing disabled control, status message, rollback, conflict handling and `onSaved` call.

- [ ] **Step 4: Run focused and Forms regression tests**

Run:

```bash
npm test -- --run src/components/forms/forms-inline-cell.test.tsx src/components/forms/forms-order-table.test.tsx src/components/forms/forms-workbench.test.tsx
```

Expected: all tests pass, with exactly one PATCH for each changed dropdown value and explicit save still required for date/text/money.

- [ ] **Step 5: Run static verification**

Run:

```bash
npm run typecheck
npm run lint -- --quiet
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Verify the rendered Order System**

At `http://192.168.4.199:3000/order-system`, activate a dropdown cell and choose another value in the authorised session. Confirm the select remains within the table cell, no checkmark/cross appears, the value saves once, and a failed request would retain existing recovery messaging. Do not edit a real business record unless an existing disposable test row is available; otherwise record browser mutation verification as blocked and rely on component tests.
