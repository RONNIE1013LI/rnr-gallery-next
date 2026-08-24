# Backend UI Unification Design

**Date:** 2026-08-25

**Status:** Approved by the user through the accepted Reply Assistant direction and the instruction to complete and deploy the remaining backend surfaces without another release prompt.

**2026-08-25 clarification:** “Unified colour” means shared neutral foundations and consistent semantic rules. It does not mean making options the same colour. Existing meaningful distinctions between order states, delivery methods, customer sources, payment reconciliation states, priorities, channels, and chart series must remain visible.

## Objective

Apply the accepted Reply Assistant operational visual language across the R&R Gallery backend: Admin Dashboard, Admin Orders, Order System Forms, Customers, Payment Requests, and their shared detail/form states. Preserve all business behavior and deploy only after complete verification.

## Visual Direction

- Operate mode: scanability, stable density, predictable actions, and mobile usability come first.
- Use the existing deep gallery green, warm ivory canvas, white surfaces, and neutral borders. Preserve distinct functional colours for statuses, options, priorities, channels, and chart series; align only inconsistent uses of the same meaning.
- Use a 4px spacing rhythm, 12-16px card radii, clear page/section/field type hierarchy, and 44px minimum mobile targets.
- Keep dense desktop tables and inline editing; make mobile content reflow into compact, readable groups.
- Use proximity and typography before additional containers. Avoid nested cards, decorative gradients, glass effects, side accent bars, and unrelated animation.

## Scope

### Included

- Order System shared tokens, desktop list hierarchy, mobile order cards, filters, saved searches, manual order drawer, and statistics layout.
- Admin navigation grouping without changing permissions, routes, or link availability.
- Reply Assistant uses only the Admin workspace chrome; the public storefront header/footer must not wrap it.
- Admin Dashboard metric density and responsive hierarchy.
- Shared Admin list, table, filter, form, detail, empty, loading, error, and action styling used by Orders, Customers, Payment Requests, and settings pages.
- Desktop and mobile visual verification with local or fictional data only.

### Excluded

- Storefront changes.
- Notification topic or delivery behavior changes.
- Database schema, migrations, production data, environment variables, auth, permissions, payment logic, shipping logic, analytics, APIs, or business rules.
- New dependencies or replacement component libraries.

## Interaction Contract

- Every existing URL, permission key, form name, input value, submit behavior, auto-save path, filter rule, saved view, inline editor, upload, invoice, deletion guard, and status meaning remains unchanged.
- Navigation groups render only when at least one child is permitted.
- Desktop retains operational density; mobile uses two-column metrics when content fits and single-column forms/details.
- Focus, hover, disabled, loading, error, empty, and overflow states remain visible and usable.
- Colour remains a fast operational cue, with text labels retained so meaning never depends on colour alone.

## Verification

- Test-first for every semantic markup or behavior-preservation hook.
- CSS source regression tests for shared visual contracts.
- Targeted Forms and Admin suites, then the complete non-database suite.
- TypeScript, ESLint, knowledge check, schema check, production build, Impeccable detector, and `git diff --check`.
- Browser screenshots at desktop and mobile for representative Admin and Forms routes.
- Release only by fast-forwarding verified work to `origin/main`; verify Vercel Production Branch, deployment SHA/ref, aliases, and HTTP smoke checks.
