# Database release re-certification — 2026-09-12

## Scope and authoritative identity

User-authorized ledger-only reconciliation; no migration SQL was executed and no business schema or business data was changed.

- Production project: Neon `misty-pine-85606785`.
- Production branch: `br-twilight-math-a7fbr5h5`; database `neondb`.
- Audit role: `neondb_owner`; application role remains `rnr_app_runtime`.
- Production host fingerprint: `baa43ddcddcac5530101232bdf74cd8f649aa60f2276c7dbd95214b3c4d2d304`.
- Vercel project: `prj_6HHmxCsLMm8oTwUhMWkpphH7rBlO`; Production branch `main`.
- Pre-release deployment/rollback point: `dpl_48cTfqbQyxCEZumsQYxcD4AKvjjx`, SHA `065f1cce4a0ae545c40191364efb2e7029984c74`.

Vercel Production PGHOST fingerprint and PGDATABASE match the Neon connection metadata. All Production database environment entries predate the last successful Production guard (run `34568758066`, PASS at `2026-09-11T06:12:12Z`). The subsequent read-only guard `34687444857` reported only environment-metadata drift after ledger reconciliation; its database identity and migration checks did not report failures.

## 0065: fully applied in schema

`0065_order_item_photo_metadata.sql` contains exactly one statement adding `public.order_items.photo_metadata`: `jsonb`, NOT NULL, default `'[]'::jsonb`. Production has all three properties. This migration declares no additional indexes, foreign keys, enums, or other effects.

- SHA-256: `ba129717daf4eb373f88a4785867e17274a2f6e470915887ca5d8b3b263506a8`.
- Journal position: 65; journal timestamp: `1789108916477`.
- Existing 65 ledger entries matched the repository prefix exactly.
- Official ledger: `drizzle.__drizzle_migrations`, serial integer `id`, text `hash`, bigint `created_at`; no user triggers.
- At `2026-09-12T10:02:15Z`, a separate transaction locked the ledger, rechecked the prefix and column definition, inserted only the missing hash/timestamp, checked all 66 entries, and committed.
- Inserted ID: 66. Independent readback: 66/66, exact hashes, timestamps and ordering.

Historical CI run `34571415853` first reports missing migration lineage after commit `21de6479` introduced 0065. Available evidence does not identify who or which mechanism originally added the column; manual application versus another schema-sync path remains unknown. This reconciliation does not assert a historical execution that cannot be proven; it certifies the already-present SQL effects.

## Environment baseline re-certification

The changed database metadata concerns TEST_DATABASE_URL (Preview/Development), updated after the last successful certification. Production database metadata and the Preview application DATABASE_URL were not changed in that interval.

Read-only remote Preview audit deployment `dpl_9WoLm8XfyrML6Lo71VQFmffBiTGc` queried actual database/role identity using the existing build environment:

| Scope | Database | Role | Target fingerprint |
| --- | --- | --- | --- |
| Preview | rnr_gallery_preview_test | rnr_gallery_preview_runtime | a6a953b4a05ac513468276f6d0283cc7dffc59554f0aa415dd8fded304a30bb3 |
| Test | rnr_gallery_ci_test | rnr_gallery_test_runtime | c793ed6abd492cae748f94975087368f9511863a0092bc8bf5c059a2118e6531 |

Both use the separate Neon project `withered-dust-81915222`, branch `br-sparkling-feather-a7jo8m7f`, host fingerprint `0ee6cff18e66be371765b572021f9e767a59ca4d4abc8ea20f2afe378a192bfd`. Development DATABASE_URL names `rnr_gallery_test` on that non-Production project. These are distinct targets and do not point at Production.

At `2026-09-12T10:04:48Z`, only GitHub's `DATABASE_ENVIRONMENT_METADATA_FINGERPRINT` was updated using the existing guard's fingerprint function:

`7fd295eecaf967aa40225ee7196c979a74f03221b81143cd2a438b4e67829c6a`

Reason: **Production database identity re-certified after environment metadata drift; authoritative database identity unchanged.**

No Vercel environment value, Production OAuth configuration, domain, or credential was changed. The temporary Preview audit build command is restored to the original `npm run build` before release. The standalone audit script is read-only, Preview-only, and not part of the normal build or runtime.

Final release, automated guard, test, build and post-deployment results must be verified separately; this document alone is not release approval or Production acceptance evidence.
