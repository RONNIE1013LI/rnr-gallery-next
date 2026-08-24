# Task 3 — Compact Mobile Order Cards

## Implementation

- Tightened the phone-only card gap, header spacing, and two-column definition-list spacing while retaining 44px value surfaces.
- Kept the existing compact field set, finance permission boundary, and order-opening action. The detail list is now named per order for assistive technology.
- Preserved the existing delivery/source/BankRecon mappings. Added the missing mobile-card presentation for Email, Courier/Australia Shipping, and delivered HOLD using the established palette.
- Did not change APIs, schema, migrations, auth, payment, shipping, analytics, chat, or desktop inline-editor behavior.

## TDD evidence

Added the grouped-card contract before the accessibility change:

```text
npm run test:run -- src/components/forms/forms-order-cards.test.tsx src/components/forms/forms-source-visual-parity.test.ts
Test Files  1 failed | 1 passed (2)
Tests  1 failed | 9 passed (10)

Unable to find an accessible element with the role "group" and name "Operational details for order 07188"
```

The smallest change names the existing definition list as that group. The focused suite then passed:

```text
npm run test:run -- src/components/forms/forms-order-cards.test.tsx src/components/forms/forms-workbench.test.tsx src/components/forms/forms-source-visual-parity.test.ts src/components/forms/forms-css-module-compile.test.ts
Test Files  4 passed (4)
Tests  17 passed (17)
```

`npm run lint -- src/components/forms/forms-order-cards.tsx src/components/forms/forms-order-cards.test.tsx`, `npm run typecheck`, and `git diff --check` also passed.

## Files changed

- `src/components/forms/forms.module.css`
- `src/components/forms/forms-order-cards.tsx`
- `src/components/forms/forms-order-cards.test.tsx`
- `.superpowers/sdd/2026-08-24-admin-visual-unification/task-3-report.md`

## Visual QA boundary

The local server at `http://192.168.4.199:3000` was opened at 390 × 844, but `/order-system` redirected to the staff sign-in page. No authentication or data action was attempted, so the required real-card screenshot check remains for an approved staff session. The viewport override was reset afterwards.

## Concerns

No scoped automated failure remains. Authenticated 390 × 844 screenshot QA remains the only task-specific follow-up; the repository's known no-`TEST_DATABASE_URL` full-suite limitation remains out of scope.
