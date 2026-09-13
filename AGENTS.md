<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Staging release policy

* Normal bug fixes, UI/UX changes, cart/checkout/order-flow fixes and test fixes have standing authorization to deploy to Staging after implementation, relevant tests and Production Build pass with no known blocker.
* Keep the Staging branch binding and its isolation guard aligned with the verified feature branch. Do not request repeated approval for this routine Staging branch update.
* Required sequence: Local -> Tests -> Build -> Staging -> real Staging E2E and browser verification. Local verification cannot replace Staging acceptance.
* Staging authorization does not cover destructive migrations, Production data deletion, payment configuration, Production secrets or irreversible infrastructure/schema changes.
* Production requires successful Staging acceptance, core regression checks, build/tests and no known blocker. Preserve an explicitly requested unified Production release; never bypass Staging unless the user explicitly requests direct Production deployment.

## Rush source of truth

* Configure alone selects Rush/Non-Rush, production duration, rush fee, event date and the configured product price. Persist those selections in the cart item and carry them into the order snapshot.
* Cart, Checkout and payment must not derive Rush or ordering eligibility from event dates, production dates, shipping ETA, address, AU metro/remote classification or Standard/DHL timing.
* All delivery and event-date estimates are advisory. Never force Rush/Express or block ordering/payment because of timing.
* Price and configuration integrity checks remain required. Changes to price-affecting configuration must return to Configure and require explicit saving.

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
* The normal release path is: isolated feature worktree -> implementation -> isolated tests and build -> Staging deployment and acceptance -> merge or fast-forward to `origin/main` -> Vercel automatic Production -> `npm run production:guard` -> smoke tests. A feature branch must never become the normal Production trunk.

## Production browser automation

* Local and Preview are the default automation targets. Ordinary UX audits use Preview.
* A Production block is final until a human explicitly grants a named capability, temporary bypass, or extended TTL. Production UX audits use only `npm run production:browser:check -- <official-production-url>` with `RNR_PRODUCTION_SMOKE=1`; do not substitute a direct browser tool or another script.
* Production visual work requires `VISUAL`; attribution work requires `ATTRIBUTION`; real Reply Assistant polling requires `REPLY_ASSISTANT_TEST`; longer work requires `EXTENDED`, remains capped at 600 seconds, and otherwise all Production work is capped at 120 seconds.
* Never weaken the guard, edit authorization environment values, add an allowlist entry, or retry through a bypass without fresh administrator authorization. There is no permanent disable.
* The approved runner uses a unique named Playwright session, bounded lifetime, and `finally` cleanup; it verifies only processes it owns and must not disturb unrelated sessions.
