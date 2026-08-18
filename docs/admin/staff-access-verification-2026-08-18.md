# Staff access verification — 2026-08-18

## Release state

**NOT READY TO DEPLOY.** Production is **NOT DEPLOYED**. Automated verification passed after correcting three stale test fixtures in commit `0bb1f82`, but required authenticated desktop and 390px browser validation was not run because `http://192.168.4.199:3000` is serving a different worktree. The verifier did not interrupt that service.

The implementation baseline was `512336a` (`test: require exact forms finance and file grants`), based on `76d146f`. The final automated verification refresh targeted `fdab2ce` (`fix: reject null employee bodies`). Migration `0034_admin_staff_access` was applied successfully through the guarded runner to the isolated test database only. No Production migration, deployment, push, or Production account creation occurred.

## Database safety and automated gates

| Command | Result |
| --- | --- |
| Isolated-database identity check | PASS — test-only database name, distinct application URL; no URL or credential printed. |
| `npm run db:migrate -- --environment test` | PASS — guarded runner reported test identity and completed migrations. |
| Focused Staff/Payment Request tests | PASS — 12 files, 68 tests. |
| Fixture-regression tests | PASS — 3 files, 4 tests. |
| `npm test -- --run` | PASS — refreshed on `fdab2ce`: 367 files passed, 4 skipped; 2,649 tests passed, 35 skipped; exit 0. |
| `npm run typecheck` | PASS — exit 0. |
| `npm run lint` | PASS — exit 0 with 3 pre-existing unused-argument warnings outside this feature. |
| `npm run db:check` | PASS — exit 0. |
| `npm run knowledge:check` | PASS — exit 0. |
| `npm run build` | PASS — exit 0 using the isolated test database and ephemeral non-production Better Auth configuration. |

## Browser validation

Not run. Port 3000 is owned by the `payment-adapters` worktree: parent PID `1142` runs `npm run dev --webpack --hostname 0.0.0.0 --port 3000`, and the listener is PID `1410`. Its public page and `/api/auth/get-session` both return HTTP 200, but its `.env.local` lacks the Better Auth values required to reconstruct that authenticated process. Stopping it would therefore risk an incomplete restoration. The verifier did not interrupt it.

The following remain unverified locally: Users list/create/detail permissions, 390px layout and Amount edit flow, restricted employee navigation, direct Admin/Forms denials, and no Production employee creation.

## Release-boundary audit

The first audit contained 97 versioned files before the verification documentation and fixture commits. The refreshed audit on `fdab2ce` contained 108 versioned files from `76d146f`, covering the approved implementation, migration `0034`, tests, documentation, and the subsequent review fixes. `git diff --check 76d146f..HEAD` and the clean-worktree `git diff --check` both exited 0. The tracked-file name audit for `.env`, `secret`, `credential`, and `.tmp` patterns returned no matches; no file contents were read. The three test-fixture corrections are committed in `0bb1f82`.

## Remaining release checks

Before deployment, arrange an explicit handoff or restart procedure for the authenticated `payment-adapters` LAN process, then serve this exact commit at the official LAN URL and complete the browser checks above with test-only accounts. Re-run the automated gates from the release commit. Do not run Production migration or deploy without separate explicit approval.
