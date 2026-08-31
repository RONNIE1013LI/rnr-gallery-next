# Production browser automation

## Normal development

Use Local or Preview for repository automation. Preview is the ordinary UX-audit target. A supplied Production URL, urgency, or missing Preview does not authorize Production automation.

## Approved Production smoke

The only normal Production browser entrypoint is:

```bash
RNR_PRODUCTION_SMOKE=1 npm run production:browser:check -- https://rnrgallery.com/
```

It accepts only the official HTTPS Production hosts, creates a unique owned Playwright session, opens `about:blank` first, confines top-level navigation to approved hosts, and cleans up its page, context, browser, daemon, and owned process tree in `finally`. It must not close or kill unrelated sessions. Do not replace it with direct Playwright, another script, or a browser tool.

## Capabilities and limits

Every approved Production run has exactly one capability:

| Capability | Use | Limit | Resource policy |
| --- | --- | --- | --- |
| `DEFAULT` | Standard smoke | 120 seconds | Images, media, and fonts blocked; Customer Chat and Reply Assistant polling disabled. |
| `VISUAL` | Visual verification | 120 seconds | Images and fonts allowed; media stays blocked unless `--media` is explicitly supplied. |
| `ATTRIBUTION` | Attribution-query reproduction | 120 seconds | Attribution parameters are allowed; no purchases or conversion actions. |
| `REPLY_ASSISTANT_TEST` | Real Reply Assistant polling test | 120 seconds | Only Reply Assistant polling is allowed; Customer Chat polling remains disabled. |
| `EXTENDED` | Work that truly exceeds ordinary smoke time | 121–600 seconds | Keeps `DEFAULT` resource and polling policy. |

`VISUAL` is required for Production visual work, `ATTRIBUTION` for attribution work, and `REPLY_ASSISTANT_TEST` for real Reply Assistant polling. `EXTENDED` is required for any TTL above 120 seconds and cannot exceed 600 seconds.

## Temporary grants

The guard is on by default and has no permanent disable. A temporary bypass needs fresh administrator authorization and all of: the explicit authorization flag, named owner, reason, start time, and expiry no more than 600 seconds after start. Expired, future, malformed, or overlong grants fail closed.

Agents must not weaken the guard, edit authorization environment values, add an allowlist entry, switch scripts, or retry through a bypass without fresh administrator authorization. A Production block is final until a human explicitly grants the named capability, temporary bypass, or extended TTL.

## Static repository guard

`npm run automation:guard` scans executable automation surfaces: `scripts`, `tests`, `test`, `e2e`, and `playwright`, plus browser-, smoke-, screenshot-, visual-, UI-audit-, E2E-, Playwright-, and Lighthouse-named files. It ignores binary files and build/dependency/worktree directories. A hard-coded official Production host outside the small approved guard, runner, and drift-guard path list fails with `PRODUCTION_AUTOMATION_HARDCODE_BLOCKED`; output contains only relative file paths and line numbers, never source lines or URLs.

The guard runs before the existing Production deployment-source check in `prebuild`.

## Admin monitor is deferred

No Admin Production Automation Monitor is included here. The current database and analytics schema lacks a safe automation event ledger, and Production server code cannot truthfully inspect local Mac process ownership. A real monitor would require separately approved Production writes/storage, a signed ingestion secret or API, a Vercel observability token, or a local agent.

It would be misleading to show hard-coded zeroes or process-local serverless memory. A future approved monitor must use metadata-only storage, remain read-only for operators, and provide no disable, bypass, TTL, or process-kill controls.
