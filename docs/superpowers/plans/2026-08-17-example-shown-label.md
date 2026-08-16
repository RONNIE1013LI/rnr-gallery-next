# Product Configurator Example Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading shared configurator label `Your custom artwork` with `Example shown`.

**Architecture:** Keep the existing shared `ProductConfigurator` and change only its eyebrow copy. Extend the existing preview regression test so every product using this component inherits the same verified label.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- Use the exact visible text `Example shown`.
- Remove the visible text `Your custom artwork` from the shared configurator.
- Do not change the product title, supporting description, preview image, pricing or configuration behaviour.
- Do not add dependencies or refactor unrelated code.
- Do not deploy as part of this implementation task.

---

### Task 1: Update the shared configurator example label

**Files:**
- Modify: `src/components/product-configurator.tsx:359`
- Test: `src/components/product-configurator.test.tsx:224-238`

**Interfaces:**
- Consumes: the existing shared `ProductConfigurator` preview region named `Artwork preview`.
- Produces: the exact shared visible label `Example shown` on all product configurator pages.

- [ ] **Step 1: Write the failing regression assertion**

Extend `keeps a product preview beside the live order summary while configuring` with:

```tsx
expect(within(preview).getByText("Example shown")).toBeVisible();
expect(within(preview).queryByText("Your custom artwork")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/components/product-configurator.test.tsx -t "keeps a product preview"
```

Expected: FAIL because `Example shown` is not present.

- [ ] **Step 3: Implement the minimal shared copy change**

In `src/components/product-configurator.tsx`, replace:

```tsx
<p className={styles.eyebrow}>Your custom artwork</p>
```

with:

```tsx
<p className={styles.eyebrow}>Example shown</p>
```

- [ ] **Step 4: Run focused and static verification**

Run:

```bash
npm test -- src/components/product-configurator.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Run the production build**

Run with the repository's validation-only environment:

```bash
BETTER_AUTH_URL='https://build.local.invalid' \
BETTER_AUTH_SECRET='build-only-secret-with-32-characters' \
DATABASE_URL='postgresql://build:build@127.0.0.1:65432/build' \
RNR_PRIVATE_UPLOAD_DIR='/tmp/rnr-codex-build-uploads' \
PAYMENT_RETURN_BASE_URL='https://build.local.invalid' \
npm run build
```

Expected: production build exits 0.

- [ ] **Step 6: Commit the copy change**

```bash
git add src/components/product-configurator.tsx src/components/product-configurator.test.tsx
git commit -m "fix: label configurator image as example"
```
