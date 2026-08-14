# Framework Security Upgrade Design

## Goal

Remove the production-facing Next.js, PostCSS, and Sharp audit findings with the smallest supported stable framework upgrade while preserving all R&R Gallery behavior.

## Approved scope

- Upgrade `next` from `16.2.12` to stable `16.3.0`.
- Upgrade `eslint-config-next` from `16.2.12` to `16.3.0` so framework and lint rules stay aligned.
- Keep React, React DOM, TypeScript, Stripe, Drizzle ORM, drizzle-kit, PostgreSQL, and all business dependencies unchanged.
- Do not use `npm audit fix --force`.
- Do not add an npm override for the deprecated `@esbuild-kit` chain.
- Do not upgrade drizzle-kit to a prerelease.
- Do not modify application code, database migrations, website styling, runtime configuration, or stored data unless the stable framework upgrade exposes a confirmed compatibility defect.

## Root cause

`next@16.2.12` installs nested `postcss@8.4.31` and `sharp@0.34.5`. Those versions account for the production-facing audit findings. `next@16.3.0` declares `postcss@8.5.23` and optional `sharp@^0.35.3`, both above the affected ranges.

The remaining moderate audit chain originates in stable `drizzle-kit@0.31.10`, which still uses deprecated `@esbuild-kit/esm-loader` and `@esbuild-kit/core-utils`. The current stable drizzle-kit release has no supported dependency-only update that removes this chain. Its 1.0 releases are prerelease builds and are outside this upgrade.

## Change strategy

Update only the two version-pinned framework packages through npm so `package.json` and `package-lock.json` remain consistent. Do not accept unrelated package updates. Compare the resulting dependency tree and audit output before running application verification.

## Verification

1. Confirm `next`, `eslint-config-next`, nested PostCSS, and nested Sharp resolve to the approved versions.
2. Run `npm audit` and verify the high-severity production chain is removed.
3. Run ESLint, TypeScript, Drizzle schema check, and `git diff --check`.
4. Apply all migrations to a dedicated disposable PostgreSQL test database and run the complete Vitest suite.
5. Run the optimized production build with a validation-only HTTPS origin while preserving the LAN runtime configuration.
6. Restart the official LAN service and verify `http://192.168.4.199:3000`.
7. Use the authenticated Chrome session to check storefront, cart, checkout, order, production administration, field management, and invoice pages at desktop and mobile widths, including console errors and horizontal overflow.

## Rollback boundary

The upgrade changes only `package.json` and `package-lock.json`. If verification reveals a framework compatibility regression, restore only those two files to their pre-upgrade content. Do not reset, stash, clean, or alter any other existing worktree changes.

## Expected residual risk

Four moderate development-tool findings may remain under stable drizzle-kit. They do not ship through the Next.js production runtime and will be handled only when Drizzle publishes a compatible stable release or an independently approved migration-tool upgrade is planned.
