import { redirect } from "next/navigation";
import { requireAdminPermission } from "./require-admin";
import type { AdminPermission } from "./admin-permissions";
import { HttpError } from "./require-session";
import { safeAuthReturnPath } from "./safe-return-path";

export async function requireAdminPageFrom<T>(
  verify: () => Promise<T>,
  redirectTo: (path: string) => never,
  requestedPath = "/admin",
) {
  try {
    return await verify();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const next = encodeURIComponent(safeAuthReturnPath(requestedPath, "/admin"));
      return redirectTo(`/account/sign-in?next=${next}`);
    }
    if (error instanceof HttpError && error.status === 403) {
      return redirectTo("/account");
    }
    throw error;
  }
}

export function requireAdminPage(
  requestedPath = "/admin",
  permission: AdminPermission = "access_admin",
) {
  return requireAdminPageFrom(
    () => requireAdminPermission(permission),
    redirect,
    requestedPath,
  );
}
