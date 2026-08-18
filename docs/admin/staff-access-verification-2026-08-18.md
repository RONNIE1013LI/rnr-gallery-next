# Staff access verification — 2026-08-18

## Release state

**NOT READY TO DEPLOY.** Production is **NOT DEPLOYED**. Automated verification passed after correcting three stale test fixtures, but required authenticated desktop and 390px browser validation was not run because `http://192.168.4.199:3000` is serving a different worktree. The verifier did not interrupt that service.

The implementation baseline was `512336a` (`test: require exact forms finance and file grants`), based on `76d146f`. Migration `0034_admin_staff_access` was applied successfully through the guarded runner to the isolated test database only. No Production migration, deployment, push, or Production account creation occurred.

## Database safety and automated gates

| Command | Result |
| --- | --- |
| Isolated-database identity check | PASS — test-only database name, distinct application URL; no URL or credential printed. |
| `npm run db:migrate -- --environment test` | PASS — guarded runner reported test identity and completed migrations. |
| Focused Staff/Payment Request tests | PASS — 12 files, 68 tests. |
| Fixture-regression tests | PASS — 3 files, 4 tests. |
| `npm test -- --run` | PASS — 367 files passed, 4 skipped; 2,641 tests passed, 35 skipped; exit 0. |
| `npm run typecheck` | PASS — exit 0. |
| `npm run lint` | PASS — exit 0 with 3 pre-existing unused-argument warnings outside this feature. |
| `npm run db:check` | PASS — exit 0. |
| `npm run knowledge:check` | PASS — exit 0. |
| `npm run build` | PASS — exit 0 using the isolated test database and ephemeral non-production Better Auth configuration. |

## Browser validation

Not run. Port 3000 was owned by the `payment-adapters` worktree, not this worktree. Therefore the following remain unverified locally: Users list/create/detail permissions, 390px layout and Amount edit flow, restricted employee navigation, direct Admin/Forms denials, and no Production employee creation.

## Release-boundary audit

`git diff --name-only 76d146f..HEAD` contained 97 versioned files covering the approved implementation, migration `0034`, tests, and plan/task evidence. `git diff --check 76d146f..HEAD` and the current-worktree `git diff --check` both exited 0. The tracked-file name audit for `.env`, `secret`, `credential`, and `.tmp` patterns returned no matches; no file contents were read. Three test-fixture corrections remain uncommitted by the Task 8 commit boundary.

## Remaining release checks

Before deployment, serve this exact commit at the official LAN URL and complete the browser checks above with test-only accounts. Re-run the automated gates from the release commit. Do not run Production migration or deploy without separate explicit approval.
