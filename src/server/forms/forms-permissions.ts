import {
  FORM_PERMISSION_KEYS,
  FORM_ROLE_PRESETS,
  type FormPermissionKey,
  type FormRolePresetKey,
} from "@/domain/forms/forms-parity";
import {
  isStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";

export type FormPermission = FormPermissionKey;
export type FormCapableRole = "admin" | "staff" | "form_staff";

export type FormAccessProfile = Readonly<{
  preset: FormRolePresetKey;
  assignedOnly: boolean;
  permissions: Readonly<Record<FormPermission, boolean>>;
}>;

export function buildFormAccessProfile(
  preset: FormRolePresetKey,
): FormAccessProfile {
  const definition = FORM_ROLE_PRESETS[preset];
  const allowed = new Set<FormPermission>(definition.permissions);
  return Object.freeze({
    preset,
    assignedOnly: definition.assignedOnly,
    permissions: Object.freeze(Object.fromEntries(
      FORM_PERMISSION_KEYS.map((permission) => [permission, allowed.has(permission)]),
    ) as Record<FormPermission, boolean>),
  });
}

export function isFormAccessProfile(value: unknown): value is FormAccessProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FormAccessProfile>;
  if (!candidate.preset || !(candidate.preset in FORM_ROLE_PRESETS)) return false;
  if (typeof candidate.assignedOnly !== "boolean") return false;
  if (!candidate.permissions || typeof candidate.permissions !== "object") return false;
  return FORM_PERMISSION_KEYS.every(
    (permission) => typeof candidate.permissions?.[permission] === "boolean",
  );
}

export function isFormCapableRole(value: unknown): value is FormCapableRole {
  return value === "admin" || value === "staff" || value === "form_staff";
}

export function hasFormPermission(
  role: unknown,
  profile: FormAccessProfile | StaffAccessProfile | null,
  permission: FormPermission,
): boolean {
  if (role === "admin") return true;
  if (role === "staff") {
    return isStaffAccessProfile(profile) && profile.formPermissions[permission];
  }
  return role === "form_staff" && isFormAccessProfile(profile) && Boolean(profile.permissions[permission]);
}
