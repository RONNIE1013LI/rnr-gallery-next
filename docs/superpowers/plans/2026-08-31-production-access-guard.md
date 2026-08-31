# Production Access Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repository-owned browser automation fail closed for Production unless it uses an explicitly authorized, bounded capability, while eliminating Customer Chat and Reply Assistant polling leaks.

**Architecture:** A pure TypeScript policy module classifies targets, capabilities, TTLs, resources, and temporary grants. The existing Playwright CLI runner consumes that policy, starts at `about:blank`, installs a context-wide program before Production navigation, and owns cleanup. A session-storage marker controls application polling across Next.js client navigations, while a static scanner and repository instructions prevent new direct Production automation.

**Tech Stack:** TypeScript, Node.js, Vitest 4, React 19, Next.js 16 App Router, React Testing Library, `@playwright/cli@0.1.18`

**Spec:** `docs/superpowers/specs/2026-08-31-production-access-guard-design.md`

## Global Constraints

- Production baseline is `718932e82e81feea83184d29d6e731b7d477fb55`; implement only in the isolated `production-automation-guard` worktree.
- `origin/main` is the only Production source; release through Vercel Git integration and never run `vercel --prod`.
- Do not change Google Ads, Meta Ads, application attribution rules, cookie consent rules, checkout, payment, customer data, database schema, migrations, `next/image`, WAF, SEO/crawler behavior, or unrelated UI.
- The migration freeze remains active. The Admin monitor is deferred because no truthful event ledger exists without a separately approved Production write, secret, migration, or local agent.
- `production-guard.ts` remains the existing read-only drift checker and is not converted into browser automation.
- Every production-code behavior follows RED, verified expected failure, minimal GREEN, and focused regression.
- Guard default is `ON`; no permanent-disable state or unlimited TTL is allowed.
- Standard Production TTL is exactly 120 seconds; `EXTENDED` is greater than 120 and no more than 600 seconds.
- Cleanup may terminate only the unique Playwright CLI session/process tree created by the runner; never use `close-all`, `kill-all`, or broad Chrome process matching.
- Normal visitors and legitimate crawlers must be unaffected.

---

### Task 1: Central target, capability, resource, and temporary-grant policy

**Files:**
- Create: `scripts/automation/production-access-guard.ts`
- Create: `scripts/automation/production-access-guard.test.ts`

**Interfaces:**
- Consumes: URL strings, target mode, capability, process environment, and an injectable `Date`/clock value.
- Produces:
  - `type AutomationTargetMode = "LOCAL" | "PREVIEW" | "PRODUCTION_SMOKE"`
  - `type ProductionCapability = "DEFAULT" | "VISUAL" | "ATTRIBUTION" | "REPLY_ASSISTANT_TEST" | "EXTENDED"`
  - `type GuardStatus = { state: "ON" } | { state: "TEMP_BYPASS"; owner: string; reason: string; startedAt: Date; expiresAt: Date }`
  - `type AssertAutomationTargetInput = { rawUrl: string; targetMode: AutomationTargetMode; guardStatus: GuardStatus; productionSmokeAuthorized?: boolean }`
  - `assertAutomationTarget(input: AssertAutomationTargetInput): URL`
  - `resolveGuardStatus(env, now): GuardStatus`
  - `resolveProductionTtlSeconds(capability, requested): number`
  - `shouldBlockProductionResource(resourceType, capability, allowMedia): boolean`
  - `buildProductionSmokeUrl(input: { rawUrl: string; capability: ProductionCapability; guardStatus: GuardStatus; productionSmokeAuthorized: boolean }): URL`
  - `AUTOMATION_SESSION_STORAGE_KEY` and `AUTOMATION_CAPABILITY_STORAGE_KEY`

- [ ] **Step 1: Write the failing central-policy tests**

Create table-driven tests with literal expectations covering:

```ts
expect(() => assertAutomationTarget({
  rawUrl: "https://rnrgallery.com/",
  targetMode: "PREVIEW",
  guardStatus: { state: "ON" },
})).toThrow(/PRODUCTION_AUTOMATION_BLOCKED[\s\S]*Use approved Production Smoke workflow/);

expect(assertAutomationTarget({
  rawUrl: "http://localhost:3000/shop",
  targetMode: "LOCAL",
  guardStatus: { state: "ON" },
}).toString()).toBe("http://localhost:3000/shop");

expect(assertAutomationTarget({
  rawUrl: "https://rnr-next-platform-git-guard-test.vercel.app/",
  targetMode: "PREVIEW",
  guardStatus: { state: "ON" },
}).hostname).toBe("rnr-next-platform-git-guard-test.vercel.app");

expect(() => assertAutomationTarget({
  rawUrl: "https://example.com/",
  targetMode: "PREVIEW",
  guardStatus: { state: "ON" },
})).toThrow("AUTOMATION_TARGET_BLOCKED");
```

Also assert:

- Production smoke without `RNR_PRODUCTION_SMOKE=1` is rejected.
- Authorized Production smoke accepts each of the four official HTTPS hosts.
- `DEFAULT` rejects attribution query parameters; `ATTRIBUTION` preserves them.
- `DEFAULT` blocks image/media/font and allows document/script/stylesheet/fetch/xhr.
- `VISUAL` allows image/font, blocks media by default, and allows media only with `allowMedia=true`.
- non-`EXTENDED` capabilities resolve to 120 seconds.
- `EXTENDED` accepts 121 and 600, rejects 120, 601, missing, fractional, and infinite values.
- a temporary grant requires explicit authorization, non-empty owner/reason, start not in the future, expiry after start, and a duration no greater than 600 seconds.
- an expired grant resolves to `{ state: "ON" }`.
- no environment value can produce an `OFF` or permanent state.
- a valid temporary grant permits only one of the four official Production hosts and never permits `example.com`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test:run -- scripts/automation/production-access-guard.test.ts
```

Expected: FAIL because `production-access-guard.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

Use exact constants:

```ts
export const DEFAULT_PRODUCTION_TTL_SECONDS = 120;
export const MAX_EXTENDED_PRODUCTION_TTL_SECONDS = 600;
export const AUTOMATION_SESSION_STORAGE_KEY = "rnr_automation";
export const AUTOMATION_CAPABILITY_STORAGE_KEY = "rnr_automation_capability";

export const OFFICIAL_PRODUCTION_HOSTS = Object.freeze([
  "rnrgallery.com",
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);
```

Use environment names:

```text
RNR_PRODUCTION_SMOKE
RNR_PRODUCTION_GUARD_TEMP_BYPASS
RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED
RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER
RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON
RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT
RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT
```

Parse URLs once, lowercase hostnames, reject credentials, require HTTPS for
Preview and Production, and fail closed on invalid dates or malformed modes.
Attribution parameter detection is case-insensitive for `gclid`, `gbraid`,
`wbraid`, `fbclid`, and keys beginning `utm_`.

An official Production URL is permitted only when either (a) the target mode is
`PRODUCTION_SMOKE` and `productionSmokeAuthorized` is true, or (b) the resolved
guard status is a currently valid `TEMP_BYPASS`. The bypass may cross a
Local/Preview target-mode boundary only to one of the four official Production
hosts; it never permits an unknown host. The approved runner uses case (a) and
must not manufacture or mutate process environment values.

- [ ] **Step 4: Verify GREEN and regression**

Run:

```bash
npm run test:run -- scripts/automation/production-access-guard.test.ts scripts/production-guard.test.ts
```

Expected: both test files PASS and the existing drift guard behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add scripts/automation/production-access-guard.ts scripts/automation/production-access-guard.test.ts
git commit -m "feat(automation): add central production access policy"
```

### Task 2: Upgrade the existing approved Production browser runner

**Files:**
- Modify: `scripts/production-browser-check.ts`
- Modify: `scripts/production-browser-check.test.ts`

**Interfaces:**
- Consumes from Task 1: `buildProductionSmokeUrl`, `resolveProductionTtlSeconds`, `shouldBlockProductionResource`, `ProductionCapability`, official hosts, and storage keys.
- Produces:
  - `type ProductionBrowserCheckOptions = { url: string; capability?: ProductionCapability; ttlSeconds?: number; allowMedia?: boolean; owner?: string }`
  - `buildProductionSmokeProgram(config): string`
  - `runProductionBrowserCheck(options, dependencies): Promise<ProductionBrowserCheckResult>`
  - CLI flags `--capability=DEFAULT|VISUAL|ATTRIBUTION|REPLY_ASSISTANT_TEST|EXTENDED`, `--ttl=<seconds>`, and `--media`.

- [ ] **Step 1: Replace/extend runner tests before implementation**

Add failing tests for these observable behaviors:

1. Missing `RNR_PRODUCTION_SMOKE=1` rejects before `runCli` is called.
2. Authorized run calls `open about:blank` before `run-code` and always calls `close`.
3. A clock that passes the hard deadline before `run-code` produces a timeout and still closes.
4. A thrown run-code exception still closes and validates owned processes.
5. A Playwright assertion failure still closes and validates owned processes.
6. Successful completion reports owned browser process count `0`.
7. Existing process-tree fixture proves unrelated session PID `456` is not signalled.
8. Default program aborts image/media/font requests; visual program continues image/font; visual with `--media` continues media.
9. Context-wide navigation logic continues an official internal navigation and aborts an external top-level document.
10. The same context route handler covers a newly created popup page, proving popup navigation cannot bypass policy.
11. The init script writes `rnr_automation=1` and the selected capability before the first Production `goto`.
12. The Production route list is the literal sequence `/`, `/shop`, `/canvas`, `/banners`, `/design-gallery`, `/help`, `/account`, `/cart`.
13. Two runs sharing the same injected clock still receive different
    internally generated random session suffixes; the public options expose no
    caller-supplied session field.

Exercise the actual function returned by `buildProductionSmokeProgram`:

```ts
const operation = (0, eval)(`(${buildProductionSmokeProgram(config)})`);
await operation(fakePage);
```

The fake context must implement the Playwright boundary used by the operation
(`route`, `addInitScript`, `on`, `pages`) and invoke the captured route handler
with literal internal, external, image, font, and popup request fixtures. Assert
route continuation/abortion and operation rejection, not source-string contents.

- [ ] **Step 2: Run the runner test and verify RED**

Run:

```bash
npm run test:run -- scripts/production-browser-check.test.ts
```

Expected: FAIL on missing explicit authorization, capability, context route,
resource interception, and generated-program behavior.

- [ ] **Step 3: Implement the minimal runner upgrade**

Keep `@playwright/cli@0.1.18` and the existing dependency injection. Generate a
session internally with this shape and a random suffix:

```text
rnr-production-smoke-<process pid>-<epoch milliseconds>-<8 hex chars>
```

Inject the environment and random-suffix generator at the runner boundary so
authorization and uniqueness tests are deterministic. Read
`RNR_PRODUCTION_SMOKE` without changing it. Reject before `open` unless its
value is exactly `1`; a `TEMP_BYPASS` does not replace this runner-specific
authorization requirement.

Run commands in this order:

```ts
await runCli(session, ["open", "about:blank", "--browser", "chrome"], remainingLifetime());
await runCli(session, ["run-code", buildProductionSmokeProgram(config)], remainingLifetime());
```

The generated async Playwright function must install `context.addInitScript`
and `context.route("**/*", handler)` before its first `page.goto`. The handler
must:

- abort image/media/font according to Task 1 policy;
- inspect every top-level document navigation from every context page;
- continue official Production navigation;
- abort and record any unexpected host;
- allow ordinary subresources to follow the capability resource policy.

After each route, require an HTTP response below 400, a rendered `body`, and no
new console error. Open Customer Chat once on the homepage and assert no
`/api/customer-chat/updates` or `/api/reply-assistant/updates` resource entry in
non-Reply capabilities. Return route count, blocked resource counts, polling
counts, console error count, and unexpected navigation count from the browser
operation.

Keep nested `finally` cleanup and owned-process matching. Do not add any global
Playwright close/kill command. `main()` must parse exact flags and print only
the privacy-safe result metadata.

- [ ] **Step 4: Verify GREEN and process-safety regression**

Run:

```bash
npm run test:run -- scripts/production-browser-check.test.ts scripts/automation/production-access-guard.test.ts
```

Expected: both files PASS, including timeout, error, resource, navigation,
popup, and unrelated-process cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/production-browser-check.ts scripts/production-browser-check.test.ts
git commit -m "feat(automation): harden approved production smoke"
```

### Task 3: Persist automation mode and complete polling lifecycle protection

**Files:**
- Create: `src/lib/automation-mode.ts`
- Create: `src/lib/automation-mode.test.ts`
- Modify: `src/components/customer-chat/customer-chat.tsx`
- Modify: `src/components/customer-chat/customer-chat.test.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.test.tsx`

**Interfaces:**
- Consumes from Task 1: storage-key string values and capability names; duplicate the two public string literals in the client-safe module rather than importing Node-oriented script code into the browser bundle.
- Produces:
  - `readAutomationSession(): { active: boolean; capability: ProductionCapability | null }`
  - `pollingAllowedForAutomation(channel: "customer-chat" | "reply-assistant"): boolean`
  - Customer Chat polling always disabled for active automation.
  - Reply Assistant polling enabled for active automation only when capability is `REPLY_ASSISTANT_TEST`.

- [ ] **Step 1: Write failing browser-session marker tests**

Test real `window.location` and `sessionStorage` behavior:

```ts
window.history.replaceState(null, "", "/?rnr_automation=1&rnr_automation_capability=DEFAULT");
expect(readAutomationSession()).toEqual({ active: true, capability: "DEFAULT" });
window.history.replaceState(null, "", "/shop");
expect(readAutomationSession()).toEqual({ active: true, capability: "DEFAULT" });
```

Also assert malformed capabilities become `null`, absence of marker is inactive,
Customer Chat is disabled for every active capability, and Reply Assistant is
allowed only for `REPLY_ASSISTANT_TEST`.

- [ ] **Step 2: Run marker tests and verify RED**

Run:

```bash
npm run test:run -- src/lib/automation-mode.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal marker module and verify GREEN**

On a query marker of exactly `rnr_automation=1`, write session storage. Read
the capability first from query, then storage. Catch browser storage errors and
remain query-driven instead of throwing. Never write local storage or cookies.

Run:

```bash
npm run test:run -- src/lib/automation-mode.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing Customer Chat persistence regression**

Extend the existing automation test so it first renders with the query marker,
unmounts, removes the query through `history.replaceState`, renders again, opens
Chat, advances 10 seconds, and observes zero update fetches. Clear
`sessionStorage` in `afterEach`.

Run:

```bash
npm run test:run -- src/components/customer-chat/customer-chat.test.tsx
```

Expected: FAIL because the component currently reads only the current query.

- [ ] **Step 5: Switch Customer Chat to the shared marker and verify GREEN**

Remove its local query-parser helper and call
`pollingAllowedForAutomation("customer-chat")` at the existing poll/effect
boundaries. Preserve the 5-second normal-user interval and existing abort logic.

Run the Customer Chat test file and expect PASS.

- [ ] **Step 6: Write failing Reply Assistant lifecycle tests**

Add tests for:

- active `DEFAULT` automation advances 15 seconds with zero update fetches;
- active `REPLY_ASSISTANT_TEST` performs one update fetch at 5 seconds;
- a normal visible online user polls at 5 seconds, not 2.5 seconds;
- hidden and offline states perform zero polling;
- visibility/online/focus recovery creates one immediate request and leaves one
  scheduled loop, so the next 5-second tick adds exactly one request;
- unmount aborts the pending request's real `AbortSignal` immediately and no
  later timer performs another request.

Reset history, session storage, `navigator.onLine`, visibility state, timers,
and globals after every test.

Run:

```bash
npm run test:run -- src/app/reply-assistant/live-dashboard.test.tsx
```

Expected: FAIL on 2.5-second timing, automation suppression, offline pause, and
missing abort signal.

- [ ] **Step 7: Implement minimal Reply Assistant lifecycle changes**

Set active polling to `5_000`. Add one active `AbortController`, pass its signal
to update fetches, and abort it when hidden, offline, suppressed, or unmounted.
Use one `pollingAllowed` predicate requiring visible, online, and permitted
automation mode. Keep `inFlight` and a single recursive timer. Focus,
visibility, and online handlers clear an existing timer before one immediate
catch-up; the poll `finally` schedules exactly one next loop.

- [ ] **Step 8: Run focused polling regression**

Run:

```bash
npm run test:run -- src/lib/automation-mode.test.ts src/components/customer-chat/customer-chat.test.tsx src/app/reply-assistant/live-dashboard.test.tsx
```

Expected: all three files PASS with no timer or React act warnings.

- [ ] **Step 9: Commit**

```bash
git add src/lib/automation-mode.ts src/lib/automation-mode.test.ts src/components/customer-chat/customer-chat.tsx src/components/customer-chat/customer-chat.test.tsx src/app/reply-assistant/live-dashboard.tsx src/app/reply-assistant/live-dashboard.test.tsx
git commit -m "fix(automation): stop polling across smoke navigation"
```

### Task 4: Static repository guard and operator documentation

**Files:**
- Create: `scripts/automation/production-automation-static-guard.ts`
- Create: `scripts/automation/production-automation-static-guard.test.ts`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `.agents/skills/ux-audit/SKILL.md`
- Create: `docs/production-automation.md`

**Interfaces:**
- Consumes from Task 1: official Production host literals and approved paths.
- Produces:
  - `findForbiddenProductionAutomationReferences(rootDir): readonly Finding[]`
  - `assertNoForbiddenProductionAutomationReferences(rootDir): void`
  - npm script `automation:guard`
  - `prebuild` runs `automation:guard` before the existing Production source guard.

- [ ] **Step 1: Write failing static-guard behavior tests**

Use a temporary directory and real files. Assert:

- `tests/new-playwright.ts` containing
  `await page.goto("https://rnrgallery.com")` returns one finding;
- a Preview URL in the same file returns no finding;
- official domains in the exact approved paths return no finding;
- an official domain in `src/components/example.tsx` without an automation-like
  filename is not misclassified as executable browser automation;
- bare official hosts and full HTTPS URLs are both detected in automation files;
- findings are sorted by relative path and line number and do not include file contents.

Approved relative paths are exactly:

```text
scripts/automation/production-access-guard.ts
scripts/automation/production-access-guard.test.ts
scripts/automation/production-automation-static-guard.ts
scripts/automation/production-automation-static-guard.test.ts
scripts/production-browser-check.ts
scripts/production-browser-check.test.ts
scripts/production-guard.ts
scripts/production-guard.test.ts
```

- [ ] **Step 2: Run static-guard tests and verify RED**

Run:

```bash
npm run test:run -- scripts/automation/production-automation-static-guard.test.ts
```

Expected: FAIL because the scanner module does not exist.

- [ ] **Step 3: Implement the scanner and CLI**

Recursively scan text files under `scripts`, `tests`, `test`, `e2e`, and
`playwright`, plus repository files whose basename contains `playwright`,
`browser`, `smoke`, `screenshot`, `visual`, `ui-audit`, `e2e`, or `lighthouse`.
Skip `.git`, `.next`, `node_modules`, `coverage`, `output`, `.worktrees`, binary
files, and the exact allowlist. Throw:

```text
PRODUCTION_AUTOMATION_HARDCODE_BLOCKED
<relative path>:<line>
Use the central Production Access Guard and approved Production Smoke workflow.
```

The CLI exits nonzero on findings and writes no source lines or URLs.

- [ ] **Step 4: Verify scanner GREEN against fixture and real repository**

Run:

```bash
npm run test:run -- scripts/automation/production-automation-static-guard.test.ts
npx tsx scripts/automation/production-automation-static-guard.ts
```

Expected: fixture tests PASS and the real repository guard exits 0.

- [ ] **Step 5: Wire build enforcement**

Add:

```json
"automation:guard": "tsx scripts/automation/production-automation-static-guard.ts",
"prebuild": "npm run automation:guard && tsx scripts/verify-production-deployment-source.ts"
```

Run `npm run automation:guard` and expect exit 0.

- [ ] **Step 6: Update repository instructions and human documentation**

`AGENTS.md` and `.agents/skills/ux-audit/SKILL.md` must state:

- Local/Preview are the default automation targets.
- A Production block is final until a human explicitly grants a named
  capability, temporary bypass, or extended TTL.
- Production visual work requires `VISUAL`; attribution work requires
  `ATTRIBUTION`; real Reply Assistant polling requires
  `REPLY_ASSISTANT_TEST`; longer work requires `EXTENDED` and remains capped at
  600 seconds.
- agents must never weaken the guard, edit environment values, add an allowlist
  entry, or retry through a bypass without fresh administrator authorization.
- Production UX audit uses the approved runner; ordinary UX audit defaults to Preview.

`docs/production-automation.md` must document normal development, approved
Production smoke, exact capabilities, 120/600-second limits, resource policy,
temporary grant requirements, no permanent disable, cleanup ownership, static
guard behavior, and the Admin monitor deferral/storage reason.

- [ ] **Step 7: Run focused governance regression**

Run:

```bash
npm run test:run -- scripts/automation/production-access-guard.test.ts scripts/automation/production-automation-static-guard.test.ts scripts/production-browser-check.test.ts
npm run automation:guard
```

Expected: all focused tests and the repository scan PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/automation/production-automation-static-guard.ts scripts/automation/production-automation-static-guard.test.ts package.json AGENTS.md .agents/skills/ux-audit/SKILL.md docs/production-automation.md
git commit -m "chore(automation): enforce production browser policy"
```

## Final verification and release checklist

After all four task reviews and the whole-branch review are clean:

1. Run all focused guard and polling tests.
2. Run the project test suite using its existing database/environment exclusions;
   report unavailable DB suites separately rather than modifying them.
3. Run `npm run typecheck`, `npm run lint`, and `npm run build`.
4. Run `git diff --check` and the static guard.
5. Fetch `origin --prune`; verify the branch contains only this plan's commits.
6. Fast-forward/push through `origin/main` without rewriting history.
7. Wait for Vercel automatic Production deployment and run the read-only
   Production drift guard. Stop on any SHA/ref/alias mismatch.
8. Run exactly one `DEFAULT` Production smoke with
   `RNR_PRODUCTION_SMOKE=1`, aim for less than 30 seconds, and never exceed 120 seconds.
9. Wait 60 seconds after runner cleanup; verify owned Playwright process/session
   count is zero, unrelated sessions were untouched, and use available
   Production observability evidence to count residual headless/chat/reply/image
   requests. If observability cannot prove a count, report it as unverified rather
   than inventing zero.
10. Perform the final read-only orphan audit and report every unrelated owner
    without closing it.
