# Production Proofing and Operations Design

## Goal

Complete the Next.js production workbench with private production files, versioned design proofs, recorded customer decisions, reusable queue views, CSV export, attention alerts, workload reporting and role-safe finance summaries.

## Approved scope

This continues the production-job foundation already approved and implemented. The local WordPress eTeams-style order manager remains a business reference only. No historical customer files or personal data are imported.

## Private files and proofing

Production files use the existing private filesystem store and are never placed under `public/`. The first supported formats remain JPG, PNG, WebP, HEIC and HEIF, with the existing 25 MB limit.

`production_job_files` stores job ownership, file purpose, storage metadata and an optional design-draft version. Supported purposes are customer file, payment proof, design draft and print file. Design drafts receive a monotonically increasing version per job. Other files are unversioned.

`production_proof_reviews` stores one immutable decision for each design draft: approved or changes requested, with an optional note and the staff member who recorded the customer's response. A changes-requested decision counts as one revision round. The interface displays two free rounds and then flags subsequent rounds for an administrator to review. It does not change any order total automatically. The existing $25 new-source-photo and $30 additional-revision rules are shown as operational guidance only.

Staff can view and upload normal production files and record proof decisions. Payment proof files and their metadata require the existing production-finance permission. Every upload, download and proof decision is audited. Physical storage is compensated if the database association fails.

## Operations

`production_saved_views` stores a named query string per admin/staff user. Saved views contain filters only and never contain customer data. Users can save and delete their own views.

CSV export reuses the authoritative production filters and projections. It is administrator-only because it contains bulk customer contact data. Web finance remains sourced from the immutable order; manual finance remains sourced from the production job. The export is capped at 5,000 rows and uses CSV injection protection.

The production report is derived live from existing jobs. It shows status counts, urgent work, overdue work, jobs due in the next two calendar days, unassigned work and workload per staff member. Administrators also see payable, paid, owing, cost and profit totals; staff receive no finance projection.

The report's attention queue is the internal notification mechanism for this slice. It requires no email provider, background scheduler or push credentials and cannot silently contact customers.

## Routes and pages

- `POST /api/admin/jobs/:jobId/files` uploads a private file.
- `GET /api/admin/jobs/:jobId/files/:fileId` streams an authorized private file.
- `POST /api/admin/jobs/:jobId/proof-reviews` records a proof decision.
- `GET|POST /api/admin/jobs/views` lists or creates saved views.
- `DELETE /api/admin/jobs/views/:viewId` removes the current user's saved view.
- `GET /api/admin/jobs/export` downloads filtered CSV for administrators.
- `/admin/jobs/report` displays live workload and attention reporting.

The production detail page adds a Files & proofs section. The production list adds saved views, Export CSV and Report actions without replacing the existing filters.

## Safety and errors

- All mutations require authentication, focused permission, same-origin validation and audit records.
- File routes validate UUID ownership through both job ID and file ID.
- Payment proof access checks finance permission in addition to file permission.
- Proof decisions are idempotent and immutable per draft version.
- Saved views reject external paths and store only normalized production query parameters.
- File bytes, storage paths and hashes are never returned in JSON or audit summaries.
- No automatic fee, payment, email, order-status or customer-notification mutation is introduced.

## Verification

Use schema contract tests, service tests, database integration tests, route tests, component/page tests, lint, typecheck, migration checks, an isolated full PostgreSQL suite, a production build and authenticated browser checks at desktop and 390 px mobile widths on `http://192.168.4.199:3000`.
