# R&R Next Platform

Independent Next.js storefront work for R&R Gallery. The current persistence
slice provides PostgreSQL-backed customer authentication and saved New Zealand
and Australian addresses. It does not use or modify the separate WordPress
staging database.

## Local setup

Prerequisites are Node.js/npm compatible with the committed lockfile and a
reachable PostgreSQL database. Install exactly the locked dependency graph:

```bash
npm run backup:lan
npm ci
```

Copy `.env.example` to an ignored local environment file or supply the same
variables through the shell. Never commit or print their values.

- `DATABASE_URL` is a PostgreSQL connection string for the target environment.
- `BETTER_AUTH_URL` is the absolute app origin. Production requires HTTPS;
  development and test may use HTTP only on localhost.
- `BETTER_AUTH_SECRET` is a randomly generated secret of at least 32
  characters.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` enables optional address suggestions in the
  shared NZ/AU address form. Restrict this browser key to approved site origins
  and only the Maps JavaScript API plus Places API (New). If it is absent or
  blocked, customers can continue with the complete manual address form.

Provision PostgreSQL outside the application with a dedicated database and
least-privilege role that can run the committed migrations. Production should
also have restricted network access, encrypted connections, monitored backups,
and a tested recovery path. Application startup does not create a database or
change its schema.

With the environment exported, apply the committed schema and start the app:

```bash
npm run db:migrate
npm run dev
```

## Database and release workflow

Schema changes use Drizzle's source-controlled migrations:

```bash
npm run db:generate
npm run db:check
```

Inspect and commit the generated files under `drizzle/`. Never edit an already
applied migration. Each release must create a recoverable database backup or
recovery point, then run these steps explicitly against the release database:

```bash
npm ci
npm run db:check
npm run db:migrate
npm run build
npm run start
```

`npm run db:migrate` is a required release step and must finish before the new
application version receives traffic. A compatible application rollback may
reuse the migrated schema. If a migration is incompatible or destructive,
restore the verified recovery point or deploy a reviewed forward-fix migration;
do not improvise a production down migration.

Post-migration smoke checks should confirm:

- registration, database-backed session creation, sign-out, and sign-in;
- create, edit, and delete for one NZ and one AU saved address;
- unauthenticated account redirects and owner isolation;
- rejection of mixed-country phone numbers and invalid AU regions/postcodes;
- the existing guest catalogue, product configuration, and cart still work
  without account creation.

## Verification

```bash
npm run test:run
npm run lint
npm run typecheck
npm run db:check
npm run build
```

## Design Gallery operations

Gallery images are stored outside Git. Set `GALLERY_STORAGE_DIR` to a persistent,
private directory that is readable and writable by the application process. Do
not point it at the WordPress uploads directory.

Create a database backup before the first import. Then import the approved
manifest and its images from the repository root:

```bash
npm run gallery:import -- \
  --manifest "/absolute/path/to/rnr-design-gallery/manifest.json" \
  --images "/absolute/path/to/rnr-design-gallery" \
  --report "/absolute/path/to/gallery-import-report.json"
```

The import is content-addressed and safe to repeat. A second unchanged run must
report `0 imported, 357 unchanged`. Keep both the database backup and the
external gallery directory together when moving or restoring the application.

Customer uploads and production files also live outside Git. In production,
`RNR_PRIVATE_UPLOAD_DIR` is required and must point to an absolute, persistent,
private directory. Deploy this application on a host or container with durable
storage mounted for both `GALLERY_STORAGE_DIR` and `RNR_PRIVATE_UPLOAD_DIR`;
ephemeral/serverless filesystems are not supported. Back up both directories
together with PostgreSQL so database file references can always be restored.

Set a strong server-only `MAINTENANCE_CRON_SECRET` and schedule an authenticated
empty `POST /api/internal/uploads/cleanup` at least daily. The bounded cleanup
removes unclaimed files only after their checkout has expired (or a completed
checkout has passed its retention window), then removes empty expired checkout
sessions. Never expose this bearer secret to browser code.

Administrator access is granted to an existing account by exact email address:

```bash
npm run admin:role -- grant person@example.com
npm run admin:role -- revoke person@example.com
```

The management interface is `/admin/design-gallery`. Gallery administration
does not change product prices; it only manages approved images, taxonomy,
target products, and public visibility.

The repository integration tests require two disposable PostgreSQL targets:
an application guard database in `DATABASE_URL` and a different database named
with `test` in `TEST_DATABASE_URL`. Never point either value at staging or
production. Migrate the test database, then run the suite with both values set:

```bash
export DATABASE_URL=postgresql://.../rnr_ci_app
export TEST_DATABASE_URL=postgresql://.../rnr_integration_test
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:run
```

### Production release guardrails

`origin/main` is the only normal Production source. Always fetch it before a
release comparison; a local `main` checkout is not authoritative. Normal
releases move verified feature-worktree changes into `origin/main` and rely on
the Vercel Git integration. Do not use `vercel --prod` for a normal release.

Run the read-only drift audit after Vercel has finished the automatic deploy:

```bash
npm run production:guard
```

The command verifies GitHub `main` protection, the Vercel project and
Production Branch, current and recent Production sources, SHA equality,
Production aliases/domains/TLS, critical environment scopes and duplicates,
database-target fingerprints, and read-only migration lineage. It never repairs
Production. Required credentials are supplied through secret environment
variables and are never printed.

The GitHub workflow requires a dedicated read-only fine-grained token in
`PRODUCTION_GUARD_GITHUB_TOKEN` with repository Administration read access so
it can inspect `main` protection. It also requires the documented Vercel and
database identity secrets referenced by the workflow. Missing credentials fail
closed; the workflow does not create or rotate them.

The dedicated Vercel token is scoped only to the `RRGallery` team and rotated
on expiry. Because Vercel team tokens are not operation-scoped, the Production
guard enforces an HTTPS host allowlist and rejects every network method except
`GET` and `HEAD` before `fetch` is called. The guard never mutates Vercel.

`DATABASE_ENVIRONMENT_METADATA_FINGERPRINT` is a value-free SHA-256 baseline
of the Vercel database variable IDs, scopes, types, and update timestamps. Any
later database environment edit fails the guard until isolation is reviewed and
the baseline is deliberately recertified; database values are never fetched or
printed for this check.

Release-level database tests must not reuse a long-lived mutable database. With
an explicit non-Production administration URL and the required Production
identity fingerprints, run:

```bash
npm run release:test:isolated
```

That command creates session-specific application and integration databases,
applies the existing migrations, runs the complete Vitest suite, and removes
both databases in a `finally` cleanup path. Each worktree/session gets unique
names; if a target cannot be proven different from Production, the command
stops before creating or migrating anything.

## Dependency advisories

As of 14 August 2026, `npm audit --omit=dev` reports four moderate advisories in
the Drizzle Kit development toolchain through its legacy esbuild loader. There
are no high or critical advisories. npm only offers a `--force` remediation that
downgrades Drizzle Kit from 0.31.10 to the incompatible 0.18.1 release. That
change is intentionally not applied. Do not run `npm audit fix --force`; track
compatible upstream releases and re-run the full verification gate before
changing these dependencies.
