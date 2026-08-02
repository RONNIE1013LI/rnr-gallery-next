# R&R Next Platform

Independent Next.js storefront work for R&R Gallery. The current persistence
slice provides PostgreSQL-backed customer authentication and saved New Zealand
and Australian addresses. It does not use or modify the separate WordPress
staging database.

## Local setup

Prerequisites are Node.js/npm compatible with the committed lockfile and a
reachable PostgreSQL database. Install exactly the locked dependency graph:

```bash
npm ci
```

Copy `.env.example` to an ignored local environment file or supply the same
variables through the shell. Never commit or print their values.

- `DATABASE_URL` is a PostgreSQL connection string for the target environment.
- `BETTER_AUTH_URL` is the absolute app origin. Production requires HTTPS;
  development and test may use HTTP only on localhost.
- `BETTER_AUTH_SECRET` is a randomly generated secret of at least 32
  characters.

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

The repository integration test requires a disposable PostgreSQL database. Set
`TEST_DATABASE_URL`, migrate that same database, and then run the suite:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run
```

## Dependency advisories

As of 2 August 2026, `npm audit --omit=dev` reports seven open advisories: four
moderate and three high, through esbuild/Drizzle Kit and Next.js dependencies on
PostCSS and Sharp. npm only offers `--force` remediations that introduce
breaking, incompatible versions (including Drizzle Kit 0.18.1 and Next.js
9.3.3). Those changes are intentionally not applied. Do not run
`npm audit fix --force`; track compatible upstream releases and re-run the full
verification gate before changing these dependencies.
