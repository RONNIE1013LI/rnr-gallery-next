<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Production release policy

* `origin/main` is the only normal Production source, and Vercel Production Branch must remain `main`.
* Before comparing, merging, releasing, or deploying, run `git fetch origin --prune` and treat `origin/main` as authoritative.
* Normal releases must flow from a verified feature worktree into `origin/main`, then use the Vercel Git integration automatic Production deployment.
* Do not use `vercel --prod`, promote a feature branch, assign Production domains, force-push `main`, or rewrite published `main` history during normal work.
* Never delete `main`. GitHub protection must keep force pushes and branch deletion disabled and should require linear history without forcing a PR-only workflow.
* Promotion is reserved for an explicitly approved Production recovery, rollback, or emergency with a stated rollback point.
* The `prebuild` Production source guard is mandatory. Do not remove, bypass, weaken, or spoof its Vercel system variables to make a deployment pass.
* After deployment, verify `origin/main` SHA equals the READY Vercel Production SHA, `githubCommitRef` is `main`, and both Production domains are assigned. Any mismatch is `PRODUCTION DRIFT DETECTED` and requires an immediate stop and report.
* Do not deploy from a dirty or cross-workstream worktree. Do not include unrelated changes in a release.
* Production, Preview, Development, and Test must use distinct database targets. A Production database credential must never be shared into Preview, Development, or Test scopes.
* Production release verification must use session-specific disposable databases created by `npm run release:test:isolated`; a long-lived mutable Test database is not release evidence. Each worktree/session owns its disposable database and must clean it up even after test failure.
* Production database writes/migrations, environment changes, DNS/domain changes, and payment/authentication configuration changes require separate explicit approval.
* Before every Production migration, run the exact-prefix lineage and database-identity checks. Any hash, order, timestamp, catalog, or identity mismatch blocks migration; never bypass or rewrite applied history.
* Never edit the Production migration journal manually. Read-only audits must not mutate Production. Every Production-affecting change requires a known rollback point before release.
* The normal release path is: isolated feature worktree -> implementation -> isolated tests -> merge or fast-forward to `origin/main` -> Vercel automatic Production -> `npm run production:guard` -> smoke tests. A feature branch must never become the normal Production trunk.

## Production browser automation

* Local and Preview are the default automation targets. Ordinary UX audits use Preview.
* A Production block is final until a human explicitly grants a named capability, temporary bypass, or extended TTL. Production UX audits use only `npm run production:browser:check -- <official-production-url>` with `RNR_PRODUCTION_SMOKE=1`; do not substitute a direct browser tool or another script.
* Production visual work requires `VISUAL`; attribution work requires `ATTRIBUTION`; real Reply Assistant polling requires `REPLY_ASSISTANT_TEST`; longer work requires `EXTENDED`, remains capped at 600 seconds, and otherwise all Production work is capped at 120 seconds.
* Never weaken the guard, edit authorization environment values, add an allowlist entry, or retry through a bypass without fresh administrator authorization. There is no permanent disable.
* The approved runner uses a unique named Playwright session, bounded lifetime, and `finally` cleanup; it verifies only processes it owns and must not disturb unrelated sessions.
