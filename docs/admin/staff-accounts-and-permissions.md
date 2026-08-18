# Staff accounts and permissions

Only a database `admin` can create employees or change employee access.

## Add an employee

1. Open **Admin → Users** at `/admin/users`.
2. Select **Add employee** to open `/admin/users/new`.
3. Enter the employee's name, lowercase work email, and a long-lived initial password. Share that password only through an approved private channel.
4. Select only the Admin and Forms permissions the employee needs. Dependencies are selected and explained by the editor; do not grant broader access just to bypass a dependency.
5. Select **assigned jobs only** when the employee should only work on jobs assigned to them, then save.

The initial password remains valid until the employee changes it. Passwords are never retrievable: neither Admin nor R&R Gallery can view the initial password again. An employee who forgets it must use the existing **Forgot Password** / **Reset Password** flow at `/account/forgot-password`.

## Review or change access

From `/admin/users`, use **Open** beside an employee to visit `/admin/users/[userId]`. Review the account type, then edit the exact Admin and Forms permission groups and the assigned-only scope. Changes take effect on the next server permission check. Do not use this workflow to restrict your own Admin account; self-demotion is blocked.

`manage_roles` is not assignable to Staff. It remains an Admin-only capability.

Existing account types retain their established behaviour:

- **Admin** has full Admin and Forms access.
- **Forms staff** uses the existing Forms preset model.
- **Staff** uses the exact selected Admin and Forms permissions. A missing or invalid Staff profile has no privileged access.

## Audit expectations

Use **Admin → Audit Log** at `/admin/audit` to review employee creation, role changes, permission changes, actor, target, outcome, and safe before/after summaries. Audit records do not contain passwords, password hashes, raw request bodies, tokens, or credentials.
