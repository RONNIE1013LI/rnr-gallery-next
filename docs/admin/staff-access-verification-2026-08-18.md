# Staff access verification — 2026-08-18

## Release state

**READY TO DEPLOY.** Production is **NOT DEPLOYED**. Automated verification and the required authenticated desktop and 390px LAN browser checks are complete on the isolated test database. No Production migration, deployment, push, or Production account creation occurred.

The implementation baseline was `512336a` (`test: require exact forms finance and file grants`), based on `76d146f`. The final verification commit is `cfffb4c` (`test: wait for employee access lock deterministically`), following `cb9f144` (`fix: render payment request form safely on server`). Migration `0034_admin_staff_access` was applied successfully through the guarded runner to the isolated test database only.

## Database safety and automated gates

| Command | Result |
| --- | --- |
| Isolated-database identity check | PASS — test-only database name, distinct application URL; no URL or credential printed. |
| `npm run db:migrate -- --environment test` | PASS — guarded runner reported test identity and completed migrations. |
| Focused Staff/Payment Request tests | PASS — 12 files, 68 tests. |
| Fixture-regression tests | PASS — 3 files, 4 tests. |
| `npm test -- --run` | PASS — refreshed on `cfffb4c`: 367 files passed, 4 skipped; 2,651 tests passed, 35 skipped; exit 0. |
| `npm run typecheck` | PASS — exit 0. |
| `npm run lint` | PASS — exit 0 with 3 pre-existing unused-argument warnings outside this feature. |
| `npm run db:check` | PASS — exit 0. |
| `npm run knowledge:check` | PASS — exit 0. |
| `npm run build` | PASS — exit 0 using the isolated test database, a synthetic HTTPS auth origin, and a random process-local Better Auth secret. |

## Browser validation

The verifier captured the existing `payment-adapters` process tree, command, working directory, inherited environment keys, and LaunchAgent restoration mechanism in restrictive local-only state without printing environment values. The LaunchAgent was temporarily booted out, this exact `payment-requests` worktree was served at `http://192.168.4.199:3000` with `DATABASE_URL` set only to the guarded test database and an ephemeral Better Auth secret, then the LaunchAgent was restored. The restored listener had the `payment-adapters` working directory; both `/` and `/api/auth/get-session` returned HTTP 200. Temporary restoration and fixture state were removed afterward.

- Desktop: `/admin/users` list, filtered synthetic test employee, creation screen, permission groups, dependency selection, and created employee detail all rendered. Selecting **Update order status** automatically selected **Administration dashboard** and **View orders**.
- 390px: user creation/permission matrix rendered without horizontal overflow; the create action was visible, enabled, and uncovered. The standalone Payment Request Amount value cleared to empty and accepted exact `200.25`; the page had no horizontal overflow and its submit action was visible, enabled, and uncovered.
- Restricted synthetic staff profile: admin navigation contained only Dashboard and Orders. Direct `/admin/users` and `/forms` requests safely redirected to `/account`.
- Browser artifacts are ignored local files in `output/playwright/`: `staff-users-desktop.png`, `staff-permission-groups-desktop.png`, `staff-permission-groups-390.png`, `staff-create-action-390.png`, and `payment-request-amount-390.png`. They contain no credentials or real customer information.

The first direct Payment Request browser visit exposed an SSR error caused by dereferencing `window` during idempotency-key initialization. The minimal `globalThis.crypto` repair and server-render regression test are in `cb9f144`; the browser page was rechecked with no errors.

## Release-boundary audit

The first audit contained 97 versioned files before the verification documentation and fixture commits. The refreshed audit covers the approved implementation, migration `0034`, tests, documentation, and the subsequent browser/verification repairs. `git diff --check 76d146f..HEAD` and the worktree `git diff --check` exited 0. The tracked-file name audit for `.env`, `secret`, `credential`, and `.tmp` patterns returned no matches; no file contents were read. The three test-fixture corrections are committed in `0bb1f82`.

## Remaining release checks

Do not run a Production migration, push, or deploy without separate explicit approval. PostgreSQL emitted its existing SSL compatibility warning during guarded test/database work; it did not fail any gate. The current worktree also has an unrelated uncommitted `AGENTS.md` change that must be reviewed or separated before a release command assumes a clean checkout.
