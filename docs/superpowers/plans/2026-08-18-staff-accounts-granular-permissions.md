# Staff Accounts and Granular Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin create employee accounts with a long-lived initial password and exact per-user Admin and Forms permissions, while also fixing the Payment Request Amount field so its initial zero can be cleared.

**Architecture:** Keep Better Auth and the existing coarse `user.role` values. Add an additive `admin_staff_access` profile for `staff`, resolve that profile on every protected request, and use the existing named Admin and Forms permission keys as the only authority. Admin remains full-access, `form_staff` keeps its existing preset model, and Staff without a valid profile fails closed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Better Auth 1.6.25, Drizzle ORM/PostgreSQL, Zod, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-18-staff-accounts-granular-permissions-design.md`

## Global Constraints

- Do not replace Better Auth or add an authentication dependency.
- Initial employee passwords remain valid until changed through the existing password-reset flow.
- Plaintext passwords and password hashes must never enter API responses, audit records, logs, or fixtures derived from production data.
- `manage_roles` is never assignable to Staff; only a database `admin` manages employees.
- All permission enforcement is server-side; navigation hiding is secondary.
- Existing Staff access is backfilled before the application starts requiring profiles.
- `form_staff` presets and existing Order Entry behavior remain supported.
- Do not change Payment Request fixed amounts, currencies, providers, outstanding-balance checks, Payment Targets, orders, or ledger logic.
- Use the guarded migration runner and an isolated test database for database tests.
- Do not deploy Production without a separate explicit user instruction.

---

### Task 1: Fix the Payment Request Amount editor

**Files:**
- Modify: `src/components/admin/payment-request-form.test.tsx`
- Modify: `src/components/admin/payment-request-form.tsx`

**Interfaces:**
- Consumes: existing `PaymentRequestForm` payload with `amountCents`.
- Produces: string-backed Amount editing with unchanged integer-cent submission.

- [ ] **Step 1: Add failing input-behaviour tests**

Add tests that clear the initial zero, type a decimal, and assert exact cents; also assert an empty value cannot submit:

```tsx
it("allows the initial zero to be cleared and submits exact cents", async () => {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ request: { id: "request-1" } }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  render(<PaymentRequestForm />);

  const amount = screen.getByLabelText("Amount");
  fireEvent.change(amount, { target: { value: "" } });
  expect(amount).toHaveValue(null);
  fireEvent.change(amount, { target: { value: "200.25" } });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Outstanding balance" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ amountCents: 20_025 });
});

it("does not submit an empty amount", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  render(<PaymentRequestForm />);
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- --run src/components/admin/payment-request-form.test.tsx`

Expected: the clear assertion fails because the controlled number state immediately restores `0`.

- [ ] **Step 3: Implement string-backed editing and strict cents conversion**

Replace numeric editing state with a string and validate before fetch:

```tsx
const [amount, setAmount] = useState(
  linkedOrder ? String(linkedOrder.unreservedCents / 100) : "0",
);

const amountNumber = Number(amount);
const amountCents = Math.round(amountNumber * 100);
if (
  amount.trim() === "" ||
  !Number.isFinite(amountNumber) ||
  amountNumber <= 0 ||
  !Number.isInteger(amountNumber * 100) ||
  (linkedOrder && amountCents > linkedOrder.unreservedCents)
) {
  setMessage("Enter a valid amount with no more than two decimal places.");
  return;
}
```

Keep `type="number"`, `step="0.01"`, `min="0.01"`, and linked-order `max`; change only `value={amount}` and `onChange={(event) => setAmount(event.target.value)}`.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
npm test -- --run src/components/admin/payment-request-form.test.tsx
npm run typecheck
```

Expected: all Payment Request form tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/components/admin/payment-request-form.tsx src/components/admin/payment-request-form.test.tsx
git commit -m "fix: allow payment request amount editing"
```

---

### Task 2: Define exact permission profiles and add the Staff access schema

**Files:**
- Modify: `src/server/auth/admin-permissions.test.ts`
- Modify: `src/server/auth/admin-permissions.ts`
- Modify: `src/server/forms/forms-permissions.test.ts`
- Modify: `src/server/forms/forms-permissions.ts`
- Modify: `src/server/db/schema/admin.ts`
- Modify: `src/server/db/schema/admin-schema.test.ts`
- Create: `src/server/auth/staff-access-profile.test.ts`
- Create: `src/server/auth/staff-access-profile.ts`
- Generate: `drizzle/0034_admin_staff_access.sql`
- Generate: `drizzle/meta/0034_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `ADMIN_PERMISSION_KEYS`, `ASSIGNABLE_ADMIN_PERMISSION_KEYS`, `StaffAccessProfile`, `normalizeStaffAccessProfile(input)`, `buildLegacyStaffAccessProfile()`, and Drizzle table `adminStaffAccess`.
- Consumed by: Tasks 3–6.

- [ ] **Step 1: Add failing permission-catalogue and profile tests**

Test these exact invariants:

```ts
expect(ASSIGNABLE_ADMIN_PERMISSION_KEYS).not.toContain("manage_roles");
expect(normalizeStaffAccessProfile({
  adminPermissions: ["update_order_status"],
  formPermissions: {},
  assignedOnly: false,
}).adminPermissions).toEqual(["access_admin", "view_orders", "update_order_status"]);

expect(() => normalizeStaffAccessProfile({
  adminPermissions: ["manage_roles"],
  formPermissions: {},
  assignedOnly: false,
})).toThrow("Invalid employee permissions");

expect(() => normalizeStaffAccessProfile({
  adminPermissions: ["unknown_permission"],
  formPermissions: {},
  assignedOnly: false,
})).toThrow("Invalid employee permissions");
```

Update Forms tests so Staff without a custom profile is denied and Staff with a custom profile receives only the selected Forms keys.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- --run src/server/auth/admin-permissions.test.ts src/server/forms/forms-permissions.test.ts src/server/auth/staff-access-profile.test.ts src/server/db/schema/admin-schema.test.ts
```

Expected: missing exports/table and the old hard-coded Staff grants fail.

- [ ] **Step 3: Implement the authoritative catalogues and dependency normaliser**

Export every existing permission key from its current source and define an immutable profile:

```ts
export type StaffAccessProfile = Readonly<{
  adminPermissions: readonly AdminPermission[];
  formPermissions: Readonly<Record<FormPermission, boolean>>;
  assignedOnly: boolean;
}>;

export function normalizeStaffAccessProfile(input: unknown): StaffAccessProfile;
export function buildLegacyStaffAccessProfile(): StaffAccessProfile;
```

Use `z.object(...).strict()` and reject unknown keys before dependency expansion. Sort Admin keys by `ADMIN_PERMISSION_KEYS` and construct a full Forms boolean record in `FORM_PERMISSION_KEYS` order. Encode the dependency rules from the spec in one exported map used by both form rendering and server validation.

Change `hasAdminPermission` to exact-grant semantics:

```ts
export function hasAdminPermission(
  role: unknown,
  granted: readonly AdminPermission[],
  permission: AdminPermission,
): boolean {
  if (role === "admin") return true;
  return role === "staff" && granted.includes(permission);
}
```

Change `hasFormPermission` so Staff, like `form_staff`, must have a validated profile; retain the Admin bypass.

- [ ] **Step 4: Add the additive Drizzle schema**

Add to `src/server/db/schema/admin.ts`:

```ts
export const adminStaffAccess = pgTable("admin_staff_access", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  adminPermissions: jsonb("admin_permissions").$type<AdminPermission[]>().default([]).notNull(),
  formPermissions: jsonb("form_permissions").$type<Record<string, boolean>>().default({}).notNull(),
  assignedOnly: boolean("assigned_only").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  check("admin_staff_access_admin_permissions_array", sql`jsonb_typeof(${table.adminPermissions}) = 'array'`),
  check("admin_staff_access_form_permissions_object", sql`jsonb_typeof(${table.formPermissions}) = 'object'`),
]);
```

Import `boolean` and `AdminPermission` without creating a schema/runtime cycle.

- [ ] **Step 5: Generate and audit migration 0034**

Run: `npm run db:generate -- --name admin_staff_access`

Verify `drizzle/0034_admin_staff_access.sql` creates the table and checks, then append an idempotent backfill statement using the exact legacy Admin array and Forms JSON produced by `buildLegacyStaffAccessProfile()`:

```sql
INSERT INTO "admin_staff_access" ("user_id", "admin_permissions", "form_permissions", "assigned_only")
SELECT "id", '[...]'::jsonb, '{...}'::jsonb, false
FROM "user"
WHERE "role" = 'staff'
ON CONFLICT ("user_id") DO NOTHING;
```

The arrays/objects in SQL must exactly match the regression fixture, not a hand-written approximation.

- [ ] **Step 6: Run schema and profile verification**

Run:

```bash
npm test -- --run src/server/auth/admin-permissions.test.ts src/server/forms/forms-permissions.test.ts src/server/auth/staff-access-profile.test.ts src/server/db/schema/admin-schema.test.ts
npm run db:check
npm run typecheck
```

Expected: all focused tests, Drizzle schema check, and TypeScript pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/server/auth/admin-permissions.ts src/server/auth/admin-permissions.test.ts src/server/forms/forms-permissions.ts src/server/forms/forms-permissions.test.ts src/server/auth/staff-access-profile.ts src/server/auth/staff-access-profile.test.ts src/server/db/schema/admin.ts src/server/db/schema/admin-schema.test.ts drizzle/0034_admin_staff_access.sql drizzle/meta/0034_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: store exact staff permissions"
```

---

### Task 3: Resolve profiles for every Admin and Forms permission check

**Files:**
- Modify: `src/server/auth/require-admin.test.ts`
- Modify: `src/server/auth/require-admin.ts`
- Modify: `src/server/forms/require-forms.test.ts`
- Modify: `src/server/forms/require-forms.ts`
- Modify: `src/server/auth/require-admin-page.test.ts`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`
- Modify: `src/app/admin/jobs/page.tsx`
- Modify: `src/app/admin/jobs/[jobId]/page.tsx`
- Modify: `src/app/admin/jobs/new/page.tsx`
- Modify: `src/app/admin/jobs/report/page.tsx`
- Modify: `src/app/admin/orders/[orderId]/page.tsx`
- Modify: `src/app/api/admin/jobs/route-handler.ts`
- Modify: `src/app/api/admin/jobs/[jobId]/route-handler.ts`
- Modify: `src/app/api/admin/jobs/[jobId]/files/route-handler.ts`
- Modify: `src/app/api/admin/jobs/[jobId]/files/[fileId]/route-handler.ts`
- Modify: the existing test file paired with each changed page/route above.

**Interfaces:**
- Consumes: `adminStaffAccess`, `normalizeStaffAccessProfile`, exact permission functions from Task 2.
- Produces: `AdminAccess` containing `adminRole` and `adminPermissions`, plus exact Forms resolution for Staff.

- [ ] **Step 1: Add failing fail-closed access tests**

Change the injected resolver in `requireAdminPermissionFrom` tests to return a stored access object and prove:

```ts
await expect(requireAdminPermissionFrom(
  vi.fn().mockResolvedValue(session),
  vi.fn().mockResolvedValue({ role: "staff", profile: null }),
  new Headers(),
  "view_orders",
)).rejects.toMatchObject({ status: 403 });

await expect(requireAdminPermissionFrom(
  vi.fn().mockResolvedValue(session),
  vi.fn().mockResolvedValue({
    role: "staff",
    profile: normalizeStaffAccessProfile({
      adminPermissions: ["view_orders"],
      formPermissions: {},
      assignedOnly: false,
    }),
  }),
  new Headers(),
  "view_orders",
)).resolves.toMatchObject({
  adminRole: "staff",
  adminPermissions: expect.arrayContaining(["view_orders"]),
});
```

Add parallel Forms tests showing custom Staff can view jobs but cannot view finance/contact unless granted. Keep `form_staff` preset tests unchanged.

- [ ] **Step 2: Run access tests and confirm RED**

Run:

```bash
npm test -- --run src/server/auth/require-admin.test.ts src/server/forms/require-forms.test.ts src/components/admin/admin-shell.test.tsx
```

Expected: the old resolver and hard-coded role checks do not satisfy the new tests.

- [ ] **Step 3: Implement one database access resolver**

In `require-admin.ts`, load role plus `adminStaffAccess` in one query and return:

```ts
type StoredAdminAccess = Readonly<{
  role: unknown;
  profile: StaffAccessProfile | null;
}>;

export type AdminAccess<T extends SessionWithUser = SessionWithUser> = T & Readonly<{
  adminRole: AdminRole;
  adminPermissions: readonly AdminPermission[];
}>;
```

Admin receives `ADMIN_PERMISSION_KEYS`; Staff requires a valid profile and receives only `profile.adminPermissions`. `requireAdminFrom` remains a strict database-Admin check for account management.

In `require-forms.ts`, join both `adminStaffAccess` and `formUserAccess`. Build a custom Forms profile for Staff from `adminStaffAccess`; build the existing preset profile for `form_staff`; Admin still bypasses.

- [ ] **Step 4: Thread the exact access context through Admin UI**

Change `AdminShell` props to include `permissions` and filter navigation with:

```tsx
hasAdminPermission(administrator.role, administrator.permissions, item.permission)
```

Update `src/app/admin/layout.tsx` to pass `access.adminPermissions`. Update every direct permission call to provide the resolved array from its `access` object. Do not infer permissions from role in a component.

- [ ] **Step 5: Run focused and route-level regression**

Run:

```bash
npm test -- --run src/server/auth/require-admin.test.ts src/server/auth/require-admin-page.test.ts src/server/forms/require-forms.test.ts src/server/forms/forms-permissions.test.ts src/components/admin/admin-shell.test.tsx src/app/admin/jobs/page.test.tsx src/app/admin/jobs/'[jobId]'/page.test.tsx src/app/admin/jobs/report/page.test.tsx src/app/admin/orders/'[orderId]'/page.test.tsx
npm run typecheck
```

Expected: exact permission navigation, Admin pages, Forms pages, and TypeScript pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  src/server/auth/require-admin.ts \
  src/server/auth/require-admin.test.ts \
  src/server/auth/require-admin-page.test.ts \
  src/server/forms/require-forms.ts \
  src/server/forms/require-forms.test.ts \
  src/app/admin/layout.tsx \
  src/components/admin/admin-shell.tsx \
  src/components/admin/admin-shell.test.tsx \
  src/app/admin/jobs/page.tsx \
  src/app/admin/jobs/page.test.tsx \
  src/app/admin/jobs/'[jobId]'/page.tsx \
  src/app/admin/jobs/'[jobId]'/page.test.tsx \
  src/app/admin/jobs/new/page.tsx \
  src/app/admin/jobs/new/page.test.tsx \
  src/app/admin/jobs/report/page.tsx \
  src/app/admin/jobs/report/page.test.tsx \
  src/app/admin/orders/'[orderId]'/page.tsx \
  src/app/admin/orders/'[orderId]'/page.test.tsx \
  src/app/api/admin/jobs/route-handler.ts \
  src/app/api/admin/jobs/route.test.ts \
  src/app/api/admin/jobs/'[jobId]'/route-handler.ts \
  src/app/api/admin/jobs/'[jobId]'/route.test.ts \
  src/app/api/admin/jobs/'[jobId]'/files/route-handler.ts \
  src/app/api/admin/jobs/'[jobId]'/files/route.test.ts \
  src/app/api/admin/jobs/'[jobId]'/files/'[fileId]'/route-handler.ts \
  src/app/api/admin/jobs/'[jobId]'/files/'[fileId]'/route.test.ts
git commit -m "feat: enforce per-user staff access"
```

Before committing, inspect `git diff --cached --name-only` and unstage files not required by this task.

---

### Task 4: Create employee accounts atomically with Better Auth password hashing

**Files:**
- Create: `src/server/admin/admin-employee-service.test.ts`
- Create: `src/server/admin/admin-employee-service.integration.test.ts`
- Create: `src/server/admin/admin-employee-service.ts`
- Modify: `src/server/admin/admin-user-runtime.ts`
- Create: `src/app/api/admin/users/route-handler.ts`
- Create: `src/app/api/admin/users/route.test.ts`
- Create: `src/app/api/admin/users/route.ts`

**Interfaces:**
- Consumes: Task 2 profile normaliser, Better Auth `auth.$context.password`, `user`, `account`, `adminStaffAccess`, and `adminAuditLogs`.
- Produces: `createEmployee(actor, input)` and `POST /api/admin/users`.

- [ ] **Step 1: Add failing service tests**

Define the service dependency boundary and test exact validation:

```ts
const service = createAdminEmployeeService({
  hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  create: vi.fn().mockResolvedValue({
    id: "employee-1",
    name: "Studio Artist",
    email: "artist@example.test",
    role: "staff",
  }),
});

await expect(service.createEmployee(actor, {
  name: " Studio Artist ",
  email: "ARTIST@EXAMPLE.TEST",
  initialPassword: "long-lived-password",
  adminPermissions: ["view_orders"],
  formPermissions: { access_forms: true, view_jobs: true },
  assignedOnly: true,
  idempotencyKey: "employee-create-0001",
})).resolves.toMatchObject({ email: "artist@example.test" });
```

Assert short/long passwords, duplicate email, unknown permission, `manage_roles`, and malformed inputs fail safely. Assert repository input contains `passwordHash` but never `initialPassword`.

- [ ] **Step 2: Add failing API authorization and privacy tests**

Tests must assert:

```ts
expect(requirePermission).toHaveBeenCalledWith("manage_roles");
expect(response.headers.get("cache-control")).toBe("no-store");
expect(JSON.stringify(await response.json())).not.toContain("initialPassword");
expect(JSON.stringify(await response.json())).not.toContain("hashed-password");
```

Also test trusted-origin rejection, bounded JSON, duplicate-email 409, validation 422, and idempotent replay.

- [ ] **Step 3: Run service/API tests and confirm RED**

Run:

```bash
npm test -- --run src/server/admin/admin-employee-service.test.ts src/app/api/admin/users/route.test.ts
```

Expected: missing modules/routes fail.

- [ ] **Step 4: Implement validation, hashing, and atomic repository**

Use a strict Zod input with name 1–120, email validation/lowercasing, password length taken from `auth.$context.password.config`, idempotency key 8–255, and Task 2 permission normalisation.

Expose a repository input that contains only `passwordHash`:

```ts
type CreateEmployeeRecord = Readonly<{
  name: string;
  email: string;
  passwordHash: string;
  profile: StaffAccessProfile;
  idempotencyKey: string;
  requestSource?: string;
}>;
```

Inside one Drizzle transaction:

1. Acquire an advisory transaction lock for employee creation.
2. Re-read the actor role and require `admin`.
3. Resolve an existing successful audit row for idempotent replay.
4. Reject an existing email.
5. Insert `user` with `role: "staff"` and `emailVerified: false`.
6. Insert a `credential` account using a new UUID and the password hash.
7. Insert `adminStaffAccess`.
8. Insert `user.employee.created` audit data containing role and permission summaries only.

Use `auth.$context.password.hash(initialPassword)` through a small runtime dependency; do not enable Better Auth's Admin plugin and do not create a session.

- [ ] **Step 5: Implement the Admin-only API route**

Follow the current Users PATCH route conventions:

```ts
const access = await deps.requirePermission("manage_roles");
assertTrustedMutationRequest(request, deps.trustedOrigin);
const body = await parseBoundedJson(request);
const result = await deps.createEmployee({
  userId: access.user.id,
  email: access.user.email ?? "unknown@invalid.local",
}, { ...body, requestSource: requestSource(request) });
return Response.json({ result }, { status: 201, headers: noStore });
```

Map validation to 422, duplicate/conflicting idempotency to 409, stale Admin to 403, and unknown failures to a generic 500.

- [ ] **Step 6: Run isolated-database atomicity tests**

Use the guarded test environment and prove the stored password differs from plaintext, no session exists, the profile exists, and audit summaries contain neither plaintext nor hash:

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run src/server/admin/admin-employee-service.integration.test.ts
```

Expected: integration tests pass only against the isolated test database guard.

- [ ] **Step 7: Run focused tests and commit Task 4**

```bash
npm test -- --run src/server/admin/admin-employee-service.test.ts src/server/admin/admin-employee-service.integration.test.ts src/app/api/admin/users/route.test.ts
npm run typecheck
git add src/server/admin/admin-employee-service.ts src/server/admin/admin-employee-service.test.ts src/server/admin/admin-employee-service.integration.test.ts src/server/admin/admin-user-runtime.ts src/app/api/admin/users/route-handler.ts src/app/api/admin/users/route.test.ts src/app/api/admin/users/route.ts
git commit -m "feat: create employee accounts in admin"
```

---

### Task 5: Update employee roles and exact permission profiles safely

**Files:**
- Modify: `src/server/admin/admin-user-service.test.ts`
- Modify: `src/server/admin/admin-user-service.integration.test.ts`
- Modify: `src/server/admin/admin-user-service.ts`
- Modify: `src/server/admin/admin-user-runtime.ts`
- Modify: `src/app/api/admin/users/[userId]/route-handler.ts`
- Modify: `src/app/api/admin/users/[userId]/route.test.ts`

**Interfaces:**
- Consumes: Task 2 exact profile and Task 3 access resolution.
- Produces: `getById(userId)` and transactional `updateAccess(actor, input)` used by the detail page.

- [ ] **Step 1: Add failing service and route tests**

Cover these transitions:

```ts
await service.updateAccess(actor, {
  targetUserId: "employee-1",
  role: "staff",
  adminPermissions: ["view_orders", "update_order_status"],
  formPermissions: { access_forms: true, view_jobs: true },
  assignedOnly: true,
  idempotencyKey: "employee-access-0001",
});
```

Assert:

- Staff update requires an exact valid profile.
- `manage_roles` is rejected.
- Current Admin cannot edit their own role/access.
- A stale actor who is no longer Admin is rejected inside the transaction.
- Changing Staff to Customer/Admin/Form staff deletes `admin_staff_access`.
- Changing to `form_staff` still requires and stores an existing Forms preset.
- Idempotency replay returns the recorded state; changed payload reuse conflicts.
- Audit before/after summaries contain exact roles and permissions.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- --run src/server/admin/admin-user-service.test.ts src/app/api/admin/users/'[userId]'/route.test.ts
```

Expected: current role-only service cannot accept or persist exact profiles.

- [ ] **Step 3: Implement detail lookup and transactional access changes**

Extend the selected user DTO with nullable Staff profile fields. Replace role-only updates with `updateAccess`; retain `formPreset` for `form_staff`.

Inside the existing advisory-locked transaction:

- Re-read actor role and require Admin.
- Lock the target row.
- Reject actor/target equality.
- Normalise Staff profile inputs before writes.
- Upsert `adminStaffAccess` only for Staff.
- Delete `adminStaffAccess` for every non-Staff target role.
- Preserve existing `form_user_access` behavior for `form_staff`; delete it for other roles.
- Write one idempotent `user.access.changed` audit entry.

- [ ] **Step 4: Update PATCH route input and error mapping**

Pass only the explicit fields:

```ts
{
  targetUserId,
  role: body.role,
  adminPermissions: body.adminPermissions,
  formPermissions: body.formPermissions,
  assignedOnly: body.assignedOnly,
  formPreset: body.formPreset,
  idempotencyKey: body.idempotencyKey,
  requestSource: requestSource(request),
}
```

Keep `requirePermission("manage_roles")`, trusted-origin validation, bounded JSON, failure audit, no-store headers, and safe status codes.

- [ ] **Step 5: Run unit, integration, type and commit verification**

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run src/server/admin/admin-user-service.test.ts src/server/admin/admin-user-service.integration.test.ts src/app/api/admin/users/'[userId]'/route.test.ts
npm run typecheck
git add src/server/admin/admin-user-service.ts src/server/admin/admin-user-service.test.ts src/server/admin/admin-user-service.integration.test.ts src/server/admin/admin-user-runtime.ts src/app/api/admin/users/'[userId]'/route-handler.ts src/app/api/admin/users/'[userId]'/route.test.ts
git commit -m "feat: manage exact employee access"
```

---

### Task 6: Build mobile-friendly employee creation and permission editors

**Files:**
- Create: `src/components/admin/employee-access-fields.tsx`
- Create: `src/components/admin/employee-access-fields.test.tsx`
- Create: `src/components/admin/employee-create-form.tsx`
- Create: `src/components/admin/employee-create-form.test.tsx`
- Create: `src/components/admin/employee-access-form.tsx`
- Create: `src/components/admin/employee-access-form.test.tsx`
- Create: `src/app/admin/users/new/page.tsx`
- Create: `src/app/admin/users/new/page.test.tsx`
- Create: `src/app/admin/users/[userId]/page.tsx`
- Create: `src/app/admin/users/[userId]/page.test.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/users/page.test.tsx`
- Modify: `src/components/admin/admin.module.css`
- Delete: `src/components/admin/user-role-control.tsx`
- Delete: `src/components/admin/user-role-control.test.tsx`

**Interfaces:**
- Consumes: POST/PATCH APIs from Tasks 4–5 and permission group metadata from Task 2.
- Produces: `/admin/users/new`, `/admin/users/[userId]`, and grouped permission controls.

- [ ] **Step 1: Add failing permission-field component tests**

Test individual and group controls, dependency selection, and mobile-safe labels:

```tsx
fireEvent.click(screen.getByRole("checkbox", { name: "Update order status" }));
expect(screen.getByRole("checkbox", { name: "View orders" })).toBeChecked();
expect(screen.getByRole("checkbox", { name: "Administration dashboard" })).toBeChecked();

fireEvent.click(screen.getByRole("button", { name: "Select all Production permissions" }));
expect(screen.getByRole("checkbox", { name: "View production jobs" })).toBeChecked();
expect(screen.queryByRole("checkbox", { name: /manage staff/i })).not.toBeInTheDocument();
```

- [ ] **Step 2: Add failing create/edit page tests**

Assert both pages call `requireAdminPage(path, "manage_roles")`. Creation tests fill name/email/password and exact permissions, assert POST body, and confirm the password field is `type="password"` with `autocomplete="new-password"`. Edit tests assert PATCH body, current account is locked, Admin displays full-access read-only copy, and `form_staff` retains preset selection.

- [ ] **Step 3: Run UI tests and confirm RED**

Run:

```bash
npm test -- --run src/components/admin/employee-access-fields.test.tsx src/components/admin/employee-create-form.test.tsx src/components/admin/employee-access-form.test.tsx src/app/admin/users/new/page.test.tsx src/app/admin/users/'[userId]'/page.test.tsx src/app/admin/users/page.test.tsx
```

Expected: new modules/routes are missing and the Users page has no Add employee action.

- [ ] **Step 4: Implement shared grouped permission fields**

Render semantic `fieldset` groups from exported metadata. Keep each input label visible, give every group Select all/Clear buttons, and emit a fully normalised profile on change. Use dependency metadata rather than duplicating rules in JSX. Never render `manage_roles` as an employee checkbox.

- [ ] **Step 5: Implement employee creation**

The form submits:

```ts
{
  name,
  email,
  initialPassword,
  adminPermissions,
  formPermissions,
  assignedOnly,
  idempotencyKey: createClientId(),
}
```

After a 201 response, navigate to `/admin/users/{id}`. Clear the password state immediately after success and never place it in the URL, status message, or local/session storage.

- [ ] **Step 6: Implement employee detail editing and simplify the list**

Add **Add employee** to the page header. Replace cramped inline role editing with role/permission summary plus **Open**. The detail page uses the Task 5 DTO and PATCH route. Preserve search, filtering, pagination, role labels, current-account lock, and existing Forms preset handling.

- [ ] **Step 7: Add responsive CSS**

At desktop widths, use two permission columns where space permits. At `max-width: 900px`, use one column, full-width controls, at least 44px action targets, no horizontal overflow, and sticky actions only if they do not cover inputs or system navigation.

- [ ] **Step 8: Run UI, accessibility, and type verification**

```bash
npm test -- --run src/components/admin/employee-access-fields.test.tsx src/components/admin/employee-create-form.test.tsx src/components/admin/employee-access-form.test.tsx src/app/admin/users/new/page.test.tsx src/app/admin/users/'[userId]'/page.test.tsx src/app/admin/users/page.test.tsx src/components/admin/admin-shell.test.tsx
npm run typecheck
npx eslint src/components/admin/employee-access-fields.tsx src/components/admin/employee-create-form.tsx src/components/admin/employee-access-form.tsx src/app/admin/users/new/page.tsx src/app/admin/users/'[userId]'/page.tsx src/app/admin/users/page.tsx
```

Expected: tests, TypeScript, and targeted ESLint pass.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/components/admin/employee-access-fields.tsx src/components/admin/employee-access-fields.test.tsx src/components/admin/employee-create-form.tsx src/components/admin/employee-create-form.test.tsx src/components/admin/employee-access-form.tsx src/components/admin/employee-access-form.test.tsx src/app/admin/users/new src/app/admin/users/'[userId]' src/app/admin/users/page.tsx src/app/admin/users/page.test.tsx src/components/admin/admin.module.css
git add -u src/components/admin/user-role-control.tsx src/components/admin/user-role-control.test.tsx
git commit -m "feat: manage employee access in admin"
```

---

### Task 7: Prove sensitive-data and privilege boundaries end to end

**Files:**
- Create: `src/server/auth/staff-permission-boundaries.integration.test.ts`
- Modify: `src/app/api/admin/payment-requests/route.test.ts`
- Modify: `src/app/api/admin/orders/[orderId]/ledger/route.test.ts`
- Modify: `src/app/api/forms/jobs/[jobId]/route.test.ts`
- Modify: `src/app/api/forms/jobs/[jobId]/invoice/route.test.ts`
- Modify: `src/app/api/forms/jobs/[jobId]/files/[fileId]/route.test.ts`
- Modify: `src/server/admin/audit-service.test.ts`

**Interfaces:**
- Consumes: completed access resolver, account services, and existing protected route boundaries.
- Produces: regression evidence that direct requests cannot exceed the stored profile.

- [ ] **Step 1: Add failing integration cases for representative employees**

Create isolated test users with exact profiles:

- Order viewer: `access_admin`, `view_orders` only.
- Payment operator: `access_admin`, `view_orders`, `manage_payment`.
- Assigned artist: Forms access, assigned-only jobs, files, no finance/contact.
- Content editor: `access_admin`, `manage_content`, no publish.

Assert resolution allows only the named actions and denies missing profile, malformed profile, unknown keys, finance, customer contact, Payment Requests, refunds, audit, and role management as applicable.

- [ ] **Step 2: Run boundary integration and confirm RED if any route bypass remains**

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run src/server/auth/staff-permission-boundaries.integration.test.ts src/app/api/admin/payment-requests/route.test.ts src/app/api/admin/orders/'[orderId]'/ledger/route.test.ts src/app/api/forms/jobs/'[jobId]'/route.test.ts src/app/api/forms/jobs/'[jobId]'/invoice/route.test.ts src/app/api/forms/jobs/'[jobId]'/files/'[fileId]'/route.test.ts
```

Expected: any production route still deriving Staff access from role alone fails.

- [ ] **Step 3: Apply only concrete boundary fixes**

For every failure, route the request through `requireAdminPermission` or `requireFormPermission` with the existing narrow permission key. Do not broaden permission sets and do not add UI-only exceptions.

- [ ] **Step 4: Verify privacy-safe audit records**

Add recursive assertions that creation/access-change audit data contains neither test plaintext passwords nor stored hash values and that failure records do not serialise raw request bodies.

- [ ] **Step 5: Run the full focused security matrix and commit**

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run src/server/auth/staff-permission-boundaries.integration.test.ts src/server/admin/admin-employee-service.integration.test.ts src/server/admin/admin-user-service.integration.test.ts src/app/api/admin/users/route.test.ts src/app/api/admin/users/'[userId]'/route.test.ts src/app/api/admin/payment-requests/route.test.ts src/app/api/admin/orders/'[orderId]'/ledger/route.test.ts src/app/api/forms/jobs/'[jobId]'/route.test.ts src/app/api/forms/jobs/'[jobId]'/invoice/route.test.ts src/app/api/forms/jobs/'[jobId]'/files/'[fileId]'/route.test.ts src/server/admin/audit-service.test.ts
git add src/server/auth/staff-permission-boundaries.integration.test.ts src/app/api/admin src/app/api/forms src/server/admin/audit-service.test.ts
git commit -m "test: enforce employee permission boundaries"
```

---

### Task 8: Full verification and release documentation

**Files:**
- Create: `docs/admin/staff-accounts-and-permissions.md`
- Create: `docs/admin/staff-access-verification-2026-08-18.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: operator instructions and an evidence-only pre-deployment record.

- [ ] **Step 1: Document administrator operations**

Document exact paths and flows:

- `/admin/users` → Add employee.
- Creating a long-lived initial password.
- Choosing least-privilege Admin and Forms permissions.
- Editing access and assigned-only scope.
- Existing Admin/full-access and Forms preset behavior.
- Password Reset flow.
- Audit Log expectations.

State that passwords are never retrievable and that an employee who forgets the password uses the existing Forgot Password / Reset Password flow.

- [ ] **Step 2: Run the complete test suite on the guarded isolated database**

First run the migration identity safety check without printing URLs or credentials. Then:

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run
```

Record exact file/test counts and skipped tests. Do not call a partial suite "full".

- [ ] **Step 3: Run static and build gates**

```bash
npm run typecheck
npm run lint
npm run db:check
npm run knowledge:check
npm run build
git diff --check
```

Record every exit code and any warning separately from failures.

- [ ] **Step 4: Run local browser checks at the official LAN URL**

Using `http://192.168.4.199:3000`, verify without touching Production:

- Desktop Users list, creation page, employee detail, permission grouping, and dependency selection.
- 390px Users list, creation form, permission matrix, Amount field clear/type flow, no horizontal overflow, and no covered action buttons.
- A restricted test employee sees only permitted navigation.
- Direct navigation to one denied Admin page and one denied Forms page receives a safe redirect/403.
- No employee is actually created in Production.

Capture screenshots only if browser access is available; otherwise mark browser validation incomplete.

- [ ] **Step 5: Audit release boundaries**

Run:

```bash
git status --short
git diff --name-only 76d146f..HEAD
git diff --check 76d146f..HEAD
git log --oneline 76d146f..HEAD
git ls-files | rg '(^|/)(\.env|.*secret.*|.*credential.*|.*\.tmp)$' || true
```

Confirm only intended code, migration, tests, and docs are present. Do not expose matching secret contents.

- [ ] **Step 6: Write the verification record and commit docs**

Record:

- Final SHA and base SHA.
- Migration number and current local/test status.
- Exact commands and results.
- Local desktop/mobile evidence.
- Production deployment status as `NOT DEPLOYED`.
- Remaining risks and any external/manual check.

Commit:

```bash
git add docs/admin/staff-accounts-and-permissions.md docs/admin/staff-access-verification-2026-08-18.md
git commit -m "docs: record staff access verification"
```

- [ ] **Step 7: Stop at the deployment gate**

Report `READY TO DEPLOY` only if every required automated gate passes and local browser checks are complete. Otherwise report `NOT READY` with the exact failure. Do not push, migrate Production, or deploy until the user gives a separate explicit instruction.
