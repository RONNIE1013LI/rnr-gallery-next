# Production Access Guard Design

## Goal

Make every repository-owned Codex, Playwright, UX audit, screenshot, visual,
E2E, and development-helper workflow default to Local or Preview. Production
browser access is available only through the existing approved smoke runner or
through a short, explicit, expiring administrator grant.

This is automation governance. It does not change public website access,
legitimate crawlers, customer behavior, Ads configuration, attribution rules,
consent rules, checkout, payments, customer data, database schema, `next/image`,
or WAF behavior.

## Baseline

The implementation starts at Production commit
`718932e82e81feea83184d29d6e731b7d477fb55`.

Existing safeguards already provide a 120-second browser-check deadline,
unique Playwright CLI sessions, `finally` cleanup, owned-process cleanup, and
Customer Chat automation suppression. The new work centralizes target policy,
closes navigation and lifecycle gaps, and adds repository regression gates.

## Central policy

`scripts/automation/production-access-guard.ts` is the single source of truth
for target classification, Production hosts, capabilities, TTL limits, and
temporary grants.

Target modes are:

- `LOCAL`: permits `localhost` and `127.0.0.1` over HTTP or HTTPS.
- `PREVIEW`: permits HTTPS hosts under `vercel.app`, excluding the four
  Production hosts.
- `PRODUCTION_SMOKE`: permits only `rnrgallery.com`,
  `www.rnrgallery.com`, `rrgallery.co.nz`, and `www.rrgallery.co.nz` over
  HTTPS.

Unknown targets fail. A Production target presented to a non-Production mode
fails with:

```text
PRODUCTION_AUTOMATION_BLOCKED
Use approved Production Smoke workflow.
```

The guard never redirects, changes target mode, requests a bypass, or infers
approval.

## Capabilities

Every authorized Production session has exactly one capability:

- `DEFAULT`: 120 seconds; images, media, and fonts blocked; Customer Chat and
  Reply Assistant polling disabled.
- `VISUAL`: 120 seconds; images and fonts allowed; media remains blocked unless
  the separate `--media` switch is present; lifecycle and polling protections
  remain active.
- `ATTRIBUTION`: 120 seconds; attribution query parameters are permitted and
  preserved; the runner does not submit purchases or conversion actions.
- `REPLY_ASSISTANT_TEST`: 120 seconds; Reply Assistant polling alone is allowed;
  Customer Chat polling remains disabled.
- `EXTENDED`: an explicit duration greater than 120 seconds and no more than
  600 seconds; otherwise it keeps `DEFAULT` resource and polling behavior.

URLs containing `gclid`, `gbraid`, `wbraid`, `fbclid`, or `utm_*` parameters
require `ATTRIBUTION`. This makes attribution reproduction an explicit choice
without changing application attribution code.

## Approved Production runner

The existing `scripts/production-browser-check.ts` remains the only standard
Production browser entrypoint. It requires `RNR_PRODUCTION_SMOKE=1` before it
starts a browser.

The runner:

1. creates a unique session ID containing a process/time/random suffix;
2. records owner, capability, start time, and TTL in its local result;
3. opens `about:blank` first;
4. installs context-wide navigation, popup, init-script, and resource guards;
5. navigates the same controlled context through `/`, `/shop`, `/canvas`,
   `/banners`, `/design-gallery`, `/help`, `/account`, and `/cart`;
6. treats unexpected console errors, blocked external top-level navigation,
   assertion failures, and timeout as failures;
7. closes its page/context/browser through the named CLI session in nested
   `finally` cleanup;
8. checks only the process tree owned by its unique session and never calls a
   global Playwright kill command.

Context-level request interception covers redirects, `page.goto`, internal
navigation, newly created pages, and popups. All top-level documents must stay
on an approved Production host. Cross-origin subresources remain governed by
resource capability rules rather than being mistaken for top-level navigation.

## Resource policy

`DEFAULT`, `ATTRIBUTION`, `REPLY_ASSISTANT_TEST`, and `EXTENDED` abort
Playwright resource types `image`, `media`, and `font`.

`VISUAL` allows `image` and `font`. It allows `media` only with the explicit
`--media` switch.

All capabilities allow `document`, `script`, `stylesheet`, `fetch`, and `xhr`.
No website image configuration changes are made.

## Browser-session automation mode

`src/lib/automation-mode.ts` owns the browser marker contract. On the first
page, `?rnr_automation=1` and the capability are written to `sessionStorage` by
the Playwright context init script before application code runs. Application
code also recognizes the query marker and persists it for subsequent
same-session navigation.

The marker:

- is scoped to browser session storage;
- disappears when the browser session closes;
- is not a cookie or authentication boundary;
- does not alter consent;
- leaves normal visitors unchanged.

Customer Chat always suppresses polling in automation mode. Reply Assistant
suppresses polling unless the stored capability is `REPLY_ASSISTANT_TEST`.

## Reply Assistant lifecycle

Normal Reply Assistant polling changes from 2.5 seconds to 5 seconds. It polls
only when the document is visible and the browser is online. A single loop is
maintained per mounted component. Visibility, focus, and online recovery cause
one immediate catch-up. Hidden, offline, unmount, and automation suppression
clear timers and abort an in-flight request.

No SSE or WebSocket work is included.

## Temporary grants

Guard status defaults to `ON`. A process-local `TEMP_BYPASS` grant is valid
only when every required field is present:

- explicit authorization flag;
- owner;
- reason;
- start time;
- expiry time no more than 600 seconds after start.

Malformed, future-starting, expired, or overlong grants fail closed. Once the
expiry time passes, status resolves to `ON` automatically. A temporary grant
may permit an otherwise blocked repository workflow to target an approved
Production host, but it never expands the Production host allowlist and never
creates an unlimited lifetime.

There is no `OFF` or permanent-disable state. Codex instructions require a
fresh administrator authorization before setting capability, bypass, or TTL
inputs and forbid automatic retry by weakening the guard.

## Repository enforcement

`scripts/automation/production-automation-static-guard.ts` scans executable
automation surfaces: `scripts`, conventional `tests`/`e2e`/`playwright`
directories, and browser/audit/smoke/screenshot/visual/lighthouse-named files.
Hard-coded Production hosts fail unless the path is explicitly allowlisted for
the central guard, approved runner, their tests, or the existing read-only
Production drift guard.

The static guard runs as a Vitest regression test and from `prebuild`, making a
new ordinary Production browser script fail in tests and Vercel builds.

`AGENTS.md`, the repository UX audit skill, and
`docs/production-automation.md` require Local/Preview by default and the
approved runner for Production.

## Admin monitor decision

The requested Admin monitor is deferred from this change. The current database
and website analytics schema have no safe automation-session/event ledger, and
the Production server cannot inspect local Mac PIDs. A truthful monitor would
therefore require at least one separately approved Production concern: a new
migration, a new signed ingestion secret/API, a Vercel observability token, or
a local agent.

Displaying hard-coded zeroes or process-local serverless memory would be
misleading. P0 guard protection ships first. A later monitor task can add a
minimal metadata-only event ledger after its storage and Production-write
boundary receive explicit approval. It must remain read-only and must never
offer disable, bypass, TTL, or process-kill controls.

## Verification and release

Every behavior change follows RED, verified failure, minimal GREEN, and focused
regression. Verification includes the central guard, runner lifecycle,
navigation/popup policy, resource policy, static scanner, automation marker,
Customer Chat, and Reply Assistant tests, followed by relevant/full tests,
typecheck, lint, and build.

Release uses verified `origin/main` and Vercel's `main` Git integration only.
No `vercel --prod` or feature-branch promotion is permitted.

After deployment, one `DEFAULT` smoke runs with `RNR_PRODUCTION_SMOKE=1`, aims
to finish within 30 seconds, and has a 120-second hard limit. After cleanup,
the local process tree and Production traffic evidence are observed for 60
seconds. Other workstreams' browser processes are reported and left untouched.
