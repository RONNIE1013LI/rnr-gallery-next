# Framework Security Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the stable Next.js framework pair to 16.3.0 and remove production-facing dependency findings without changing R&R Gallery behavior.

**Architecture:** Keep the application and database untouched. Change only the pinned Next.js runtime and matching lint configuration, regenerate the npm lock graph, then validate the resolved dependency tree, full test suite, production build, LAN service, and authenticated browser flows.

**Tech Stack:** Next.js 16.3.0, React 19.2.4, npm, Vitest, Drizzle Kit, PostgreSQL, Chrome.

## Global Constraints

- Upgrade only `next` and `eslint-config-next` from `16.2.12` to `16.3.0`.
- Do not upgrade React, React DOM, TypeScript, Stripe, Drizzle ORM, drizzle-kit, PostgreSQL, or other dependencies.
- Do not use `npm audit fix --force`, dependency overrides, or prerelease packages.
- Do not modify application code, migrations, styling, runtime configuration, or data unless a confirmed Next.js compatibility defect requires a separately justified minimal fix.
- Do not stash, reset, clean, revert, delete, or commit existing user changes.

---

### Task 1: Capture the dependency baseline

**Files:**
- Read: `package.json`
- Read: `package-lock.json`

**Interfaces:**
- Consumes: Current npm dependency graph and audit report.
- Produces: A verified baseline for the two approved package changes and the residual drizzle-kit chain.

- [ ] **Step 1: Confirm the installed framework and vulnerable nested packages**

Run:

```bash
npm ls next eslint-config-next postcss sharp drizzle-kit esbuild @esbuild-kit/core-utils @esbuild-kit/esm-loader --all
```

Expected: Next 16.2.12 contains PostCSS 8.4.31 and Sharp below 0.35.0; drizzle-kit 0.31.10 contains the deprecated esbuild loader chain.

- [ ] **Step 2: Capture the audit categories**

Run:

```bash
npm audit --json
```

Expected: 3 high and 4 moderate findings, with the high findings under Next/PostCSS/Sharp.

### Task 2: Apply the minimal stable framework upgrade

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: npm registry packages `next@16.3.0` and `eslint-config-next@16.3.0`.
- Produces: A lock graph with matching Next.js runtime and lint packages.

- [ ] **Step 1: Install exact approved versions**

Run:

```bash
npm install --save-exact next@16.3.0
npm install --save-dev --save-exact eslint-config-next@16.3.0
```

Expected: Only `package.json` and `package-lock.json` change for the upgrade.

- [ ] **Step 2: Verify the resolved package graph**

Run:

```bash
npm ls next eslint-config-next postcss sharp drizzle-kit esbuild @esbuild-kit/core-utils @esbuild-kit/esm-loader --all
```

Expected: Next and eslint-config-next 16.3.0, Next's PostCSS 8.5.23, and Sharp 0.35.3; drizzle-kit remains 0.31.10.

- [ ] **Step 3: Verify the security result**

Run:

```bash
npm audit --json
```

Expected: no high or critical findings; only the stable drizzle-kit development-tool chain may remain moderate.

### Task 3: Run static and database verification

**Files:**
- Read: Entire TypeScript and Drizzle project.

**Interfaces:**
- Consumes: Upgraded dependency graph.
- Produces: Evidence that lint, types, schema metadata, and patch formatting remain valid.

- [ ] **Step 1: Run static checks**

Run:

```bash
npm run lint
npm run typecheck
npm run db:check
git diff --check
```

Expected: all commands exit zero.

### Task 4: Run full tests against an isolated database

**Files:**
- Read: `drizzle/*.sql`
- Read: `src/**/*.test.*`

**Interfaces:**
- Consumes: Complete migration history and full Vitest suite.
- Produces: A clean database-backed regression result without touching the official LAN database.

- [ ] **Step 1: Start or reuse a dedicated PostgreSQL verification container**

Use a uniquely named container and database ending in `_test`, bound only to `127.0.0.1`. Do not delete or alter the official database.

- [ ] **Step 2: Apply all migrations to the verification database**

Run `npm run db:migrate` with `DATABASE_URL` pointing only to the verification database.

Expected: migrations apply successfully.

- [ ] **Step 3: Run the complete suite**

Run `npm run test:run` with both `DATABASE_URL` and `TEST_DATABASE_URL` pointing to the verification database.

Expected: zero failed test files and zero failed tests.

### Task 5: Verify the optimized build and official LAN service

**Files:**
- Read: Existing protected LAN environment outside the repository.

**Interfaces:**
- Consumes: Official runtime configuration without exposing credentials.
- Produces: A successful production build and a healthy development service at the only official local origin.

- [ ] **Step 1: Run the optimized build**

Load the protected LAN environment without printing it, override only `BETTER_AUTH_URL` and `PAYMENT_RETURN_BASE_URL` with a validation-only HTTPS origin, and run `npm run build`.

Expected: Next.js build exits zero and lists all application routes.

- [ ] **Step 2: Restart and check the official LAN service**

Restart `com.rnr.next-platform`, poll `http://192.168.4.199:3000`, and confirm launchd reports the job as running.

Expected: the protected admin URL returns a success or authentication redirect response, and launchd remains active.

### Task 6: Run authenticated browser regression checks

**Files:**
- Read-only browser validation; no project file changes.

**Interfaces:**
- Consumes: Existing authenticated Chrome session and official URL `http://192.168.4.199:3000`.
- Produces: Desktop and mobile evidence for business-critical flows after the framework upgrade.

- [ ] **Step 1: Check desktop routes**

Inspect home, shop, product configuration, cart, checkout, account order, admin production, form fields, and invoice surfaces. Confirm content renders, navigation works, and there are no console errors.

- [ ] **Step 2: Check mobile layout**

Repeat the critical storefront, checkout, and admin production/invoice checks at 390px. Confirm `scrollWidth === clientWidth`, menus remain usable, and form controls are not clipped.

- [ ] **Step 3: Restore browser state**

Reset the temporary viewport, return the claimed user tab to `/admin/jobs`, and finalize browser control.

### Task 7: Final evidence and scope check

**Files:**
- Read: `package.json`
- Read: `package-lock.json`
- Read: `docs/superpowers/specs/2026-08-05-framework-security-upgrade-design.md`
- Read: `docs/superpowers/plans/2026-08-05-framework-security-upgrade.md`

**Interfaces:**
- Consumes: All verification outputs.
- Produces: A precise final report with changed files, resolved findings, residual findings, and verification evidence.

- [ ] **Step 1: Confirm the diff scope**

Run:

```bash
git status --short -- package.json package-lock.json docs/superpowers/specs/2026-08-05-framework-security-upgrade-design.md docs/superpowers/plans/2026-08-05-framework-security-upgrade.md
git diff -- package.json package-lock.json
```

Expected: dependency changes are limited to the approved framework pair and their transitive lock entries; documentation is additive.

- [ ] **Step 2: Report without committing**

Report the installed versions, audit counts, all verification commands, browser results, residual drizzle-kit risk, and any compatibility findings. Do not commit.
