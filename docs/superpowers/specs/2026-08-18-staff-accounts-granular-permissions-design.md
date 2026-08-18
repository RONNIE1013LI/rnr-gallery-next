# Staff Accounts and Granular Permissions Design

**Date:** 2026-08-18

**Status:** Approved in chat; awaiting written-spec review

**Scope:** Admin-created employee accounts, per-employee permissions, and the Payment Request amount-field input fix.

## Goal

Allow an administrator to create employee accounts with an initial password and assign the minimum permissions each employee needs. Permissions must be enforced by every protected server page and API, not only by hidden navigation. Separately, allow the Payment Request amount input to be cleared normally on mobile without changing fixed-amount payment behavior.

## Non-goals

- Do not replace Better Auth.
- Do not build user-defined roles, role inheritance, teams, invitations, account deletion, or employee impersonation.
- Do not change customer authentication, payment amounts, payment providers, orders, or the Payment Target / ledger architecture.
- Do not change the existing `form_staff` presets or remove the Forms portal.
- Do not force an employee to change the initial password. The initial password remains valid until the employee resets it through the existing password-reset flow.
- Do not expose `manage_roles` as an assignable employee permission.

## Current state

The application currently stores `customer`, `form_staff`, `staff`, and `admin` in `user.role`.

- `admin` receives every Admin permission.
- `staff` receives one hard-coded Admin permission set and one hard-coded Forms permission set.
- `form_staff` uses a separate `form_user_access` record and one of four existing Forms presets.
- The Users page can change an existing account's role but cannot create an employee or assign an exact per-user permission set.
- Admin pages and API routes already use named permission checks. The missing capability is a per-user source for those named checks.

## Chosen approach

Add one exact permission profile per `staff` account while keeping the existing roles as coarse account types.

This is preferred over creating many department roles because it provides action-level control without role explosion. It is preferred over a fully dynamic RBAC subsystem because R&R Gallery does not currently need user-defined roles, inheritance, or shared role templates.

## Data model

Create an additive `admin_staff_access` table:

- `user_id`: primary key and foreign key to `user.id`, cascade on user deletion.
- `admin_permissions`: non-null JSONB array of recognised `AdminPermission` keys.
- `form_permissions`: non-null JSONB object containing recognised `FormPermission` boolean values.
- `assigned_only`: non-null boolean controlling Forms job scope.
- `created_at` and `updated_at`: timezone-aware timestamps.

Database checks must confirm that `admin_permissions` is a JSON array and `form_permissions` is a JSON object. Runtime validation must reject unknown, duplicated, malformed, or non-string Admin permission keys and malformed Forms permission values.

The migration must backfill every existing `staff` account with the permissions it has immediately before the migration. This preserves current production access. After migration, a `staff` account without a valid `admin_staff_access` row fails closed and receives no Admin or Forms access.

`admin` accounts do not need a profile and continue to receive all permissions. `form_staff` continues to use `form_user_access`. `customer` receives no administrative or Forms access.

No destructive migration or removal of existing role fields is required.

## Permission model

The existing named permission keys remain the authoritative vocabulary. The employee editor groups them for usability but does not replace them with new UI-only flags.

### Admin workspace groups

- Dashboard: `access_admin`.
- Orders: `view_orders`, `update_order_status`.
- Customers: `view_customers`.
- Production: `view_production_jobs`, `create_manual_jobs`, `update_production_jobs`, `view_production_files`, `upload_production_files`, `review_production_proofs`, `manage_production_views`, `view_production_reports`, `export_production_jobs`, `manage_production_fields`, `view_production_finance`, `update_production_finance`.
- Catalogue: `manage_gallery`, `manage_prices`, `delete_media`.
- Content: `manage_content`, `publish_content`.
- Commerce: `update_payment_status`, `record_refund`, `manage_shipping`, `manage_payment`.
- Oversight and support: `view_audit`, `use_reply_assistant`.

`manage_roles` is deliberately absent from the employee permission editor. Only an account whose database role is `admin` can create employees, change roles, change employee permissions, or set an employee's initial credential.

### Forms / Order Entry groups

The current Forms permission keys remain authoritative: access, view/create/update jobs, view customer contact, view/upload files, update production and delivery status, view/manage statistics, and manage saved views. The existing `assigned_only` control remains available.

### Dependencies

One central dependency map is used by the UI and validated by the server. At minimum:

- Every employee profile includes `access_admin` when any Admin permission is selected.
- Updating an order requires `view_orders`.
- Updating production jobs requires `view_production_jobs`.
- Creating manual jobs requires `view_production_jobs`.
- Viewing, uploading, or reviewing production files requires `view_production_jobs`; upload/review also requires `view_production_files`.
- Updating production finance requires `view_production_finance` and `view_production_jobs`.
- Exporting or viewing production reports requires `view_production_jobs`.
- Publishing content requires `manage_content`.
- Recording refunds or updating payment status requires `manage_payment` and `view_orders`.
- Every selected Forms action requires `access_forms` and `view_jobs`; write actions also require their relevant view permission.

The UI automatically selects dependencies and explains them. The server independently normalises and validates the same rules so a crafted request cannot bypass them.

## Permission resolution

Introduce an immutable access context containing the database role and resolved permission profile.

- `admin`: all Admin and Forms permissions.
- `staff`: only the validated permissions stored in `admin_staff_access`.
- `form_staff`: no Admin permissions; Forms permissions continue to come from `form_user_access`.
- `customer` or unknown values: no privileged permissions.

`requireAdminPermission`, `requireAdminPage`, and `requireFormPermission` must resolve current database access on every permission check. Permission changes therefore take effect without waiting for a new login. Navigation visibility uses the same resolved access context but remains a convenience only; server checks are authoritative.

All current direct calls to `hasAdminPermission` must receive the resolved access context. No production path may fall back to the old hard-coded Staff set after the migration.

## Employee creation

Add an administrator-only `POST /api/admin/users` endpoint and `/admin/users/new` page.

Required input:

- Name.
- Normalised, lowercase email.
- Initial password.
- Exact Admin permission selection.
- Exact Forms permission selection and `assigned_only` value.

The initial password uses the password length policy and hash implementation from the pinned Better Auth runtime. Plaintext is held only for the request and hash operation. It is never stored in the `user` table, returned by an API, inserted into audit metadata, or logged.

The database transaction creates:

1. The `user` row with role `staff`.
2. The Better Auth credential `account` row containing only the password hash.
3. The `admin_staff_access` profile.
4. A redacted Admin audit record.

The transaction is all-or-nothing. Duplicate email, invalid permissions, invalid password, reused idempotency keys, and concurrent duplicate creation return safe errors without leaving a partial employee account. No login session is created for the employee during Admin creation.

The initial password remains valid until the employee changes it through the existing Forgot Password / Reset Password flow. There is no first-login password-change gate.

## Employee management UI

The Users page keeps search and filtering and adds a clear **Add employee** action.

The user table shows account type and a compact permission summary. Editing moves to `/admin/users/[userId]` so the permission matrix is usable on desktop and mobile instead of being compressed into a table cell.

The employee detail editor provides:

- Account identity and current account type.
- Permission groups with individual checkboxes.
- Group-level Select all / Clear actions.
- Forms assigned-only control.
- Clear dependency explanations.
- Save confirmation and validation errors close to the affected group.

Existing Admin accounts remain full-access. The signed-in administrator cannot demote or restrict their own account. Existing `form_staff` role presets remain available and continue to be managed through the existing Forms access mechanism.

Changing a user away from `staff` removes its `admin_staff_access` row in the same transaction. Changing a user to `staff` requires an explicit valid profile; the server must not silently grant the legacy Staff defaults.

Account deletion and administrator password resets are not included.

## Audit and security

Only a current database `admin` may create employees or modify roles and profiles. This is checked again inside the database transaction to prevent stale-session privilege changes.

Every employee creation, role change, and permission change records:

- Actor user ID and actor email.
- Target user ID.
- Action and result.
- Before/after role and permission summaries.
- Request source and idempotency key where available.

Audit records must never include passwords, password hashes, raw request bodies, cookies, tokens, or credentials.

Mutation endpoints retain trusted-origin validation, bounded JSON parsing, idempotency, safe error messages, and `Cache-Control: no-store`.

## Payment Request amount input

The Amount control stores its editing value as a string rather than coercing every keystroke to a number. This allows the user to delete the initial `0`, type a decimal normally, and use the mobile numeric keyboard.

On submission, the value is converted once to integer cents. Empty, non-finite, zero, negative, over-limit, or more-than-two-decimal values are rejected before the request is sent. Linked-order maximum and server-authoritative outstanding-balance checks remain unchanged.

The amount fix changes only input behaviour; it does not change fixed-price Payment Request semantics, currency, cents conversion, or provider amounts.

## Testing

Tests must prove:

- The Amount input can transition from `0` to empty to a valid decimal and submits exact cents.
- Invalid Amount values cannot create requests.
- Migration backfills existing Staff defaults and new Staff without a valid profile fails closed.
- Admin receives all permissions; Staff receives only stored permissions; Forms staff remains isolated from Admin.
- Every permission dependency is normalised and enforced server-side.
- Hidden navigation and direct page/API access agree, while direct server denial remains authoritative.
- A custom employee without payment permission cannot access Payment Requests or payment APIs.
- A custom employee without customer-contact or finance permissions cannot retrieve those fields through Forms/Admin APIs.
- Only Admin can create employees or change permission profiles.
- Employee creation hashes the password, creates no session, writes all records atomically, and never places plaintext/hash in the audit record or response.
- Duplicate email and idempotency replay are safe.
- Existing role changes, Forms presets, customer sign-in, Admin sign-in, Password Reset, Order Entry, payments, checkout, and production workflows regress cleanly.

Verification before release includes focused tests, database integration tests on an isolated test database, TypeScript, ESLint, Drizzle schema check, production build, `git diff --check`, and mobile/desktop browser checks of the Users and Payment Request pages.

## Rollout and rollback

Release order is additive migration, application deployment, then read-only and authenticated smoke tests. The migration must run through the existing guarded migration runner with explicit environment and database identity verification.

The schema is additive. If application code must be rolled back, the new table remains harmless and the previous application continues using roles and `form_user_access`. Do not perform a destructive production rollback.

No production deployment is part of implementation until the user explicitly authorises it.
