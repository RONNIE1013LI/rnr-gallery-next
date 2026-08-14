# R&R Gallery release-candidate preflight

Date: 14 August 2026
Branch: `feat/payment-adapters`
Baseline commit: `3fd4e86`
Deployment target: Vercel Staging, Sydney (`syd1`)

## Release boundary

This document records the candidate boundary only. It does not authorise or record a deployment.

The candidate may include:

- Next.js application and server code under `src/`
- automated tests associated with the application
- Drizzle migrations and migration metadata
- public marketing and product media under `public/media/`
- operational scripts and their tests
- npm dependency metadata (`package.json` and `package-lock.json`)
- Vercel region and install configuration
- project documentation and project-local Codex skills

The candidate must exclude:

- `.env.local` and every other private environment file
- local browser state under `.playwright-cli/`
- generated screenshots and audit output under `output/`
- `pnpm-lock.yaml` and `pnpm-workspace.yaml`; npm is the sole package manager
- Next.js build output, coverage, local data and dependency directories

Excluded files remain local unless separately removed by the owner. Exclusion is not deletion.

## Infrastructure already prepared

- Vercel Staging project: Sydney functions (`syd1`), Node.js 24, `npm ci`
- private Vercel Blob store: Sydney
- managed PostgreSQL project: Sydney
- isolated empty databases for CI and integration tests
- no Production deployment or Production data migration

## Security checks

- `.env.local` is ignored and outside the candidate.
- `.env.example` contains names and defaults only; credentials remain empty.
- credential-shaped values found in changed source are test fixtures.
- no private-key marker was found in reachable Git history.

## Before an RC commit

1. Review the complete staged file list; do not use an unreviewed `git add -A`.
2. Confirm all Drizzle migrations are ordered and pass `db:check`.
3. Run a clean npm install, type check, lint, full test suite and Production build.
4. Confirm the candidate contains no private customer files or credentials.
5. Record the exact RC commit and rollback commit.
6. Connect an approved Git remote before any Vercel deployment.

## Verification snapshot

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run db:check`: passed.
- `npm run test:run`: 228 test files and 1,483 tests passed. Eighteen integration suites were not run because this environment does not currently provide the required isolated `TEST_DATABASE_URL`; they were not pointed at the application database.
- Production build: passed with a process-only HTTPS validation origin. The local LAN origin remains HTTP for local browsing and was not written into Production configuration.
- Local LAN runtime: recovered and verified at `http://192.168.4.199:3000/`. The incident was caused by a long-running Next.js process retaining an obsolete pnpm worker path after dependencies had been rebuilt with npm. The official LaunchAgent was restarted, generated `.next` output was quarantined, and the recovered server returned HTTP 200 without new server-log errors.
- Real-browser check: homepage title and heading rendered correctly at 390 px, with no horizontal overflow and no console errors. One development-only unused CSS preload warning remains.

## Current blockers

- No Git remote is configured. Staging deployment must not proceed until an approved repository remote exists and this large candidate has been reviewed as one traceable RC.
- The full integration suite still requires a dedicated disposable test database exposed as `TEST_DATABASE_URL`. It must remain separate from application, staging and Production data.
