<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Production release policy

* `origin/main` is the only normal Production source, and Vercel Production Branch must remain `main`.
* Before comparing, merging, releasing, or deploying, run `git fetch origin --prune` and treat `origin/main` as authoritative.
* Normal releases must flow from a verified feature worktree into `origin/main`, then use the Vercel Git integration automatic Production deployment.
* Do not use `vercel --prod`, promote a feature branch, assign Production domains, force-push `main`, or rewrite published `main` history during normal work.
* Promotion is reserved for an explicitly approved Production recovery, rollback, or emergency with a stated rollback point.
* The `prebuild` Production source guard is mandatory. Do not remove, bypass, weaken, or spoof its Vercel system variables to make a deployment pass.
* After deployment, verify `origin/main` SHA equals the READY Vercel Production SHA, `githubCommitRef` is `main`, and both Production domains are assigned. Any mismatch is `PRODUCTION DRIFT DETECTED` and requires an immediate stop and report.
* Do not deploy from a dirty or cross-workstream worktree. Do not include unrelated changes in a release.
* Production database writes/migrations, environment changes, DNS/domain changes, and payment/authentication configuration changes require separate explicit approval.
* Before every Production migration, run the exact-prefix lineage and database-identity checks. Any hash, order, timestamp, catalog, or identity mismatch blocks migration; never bypass or rewrite applied history.
