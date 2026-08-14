import { redirect } from "next/navigation";

import { safeAuthReturnPath } from "@/server/auth/safe-return-path";
import { HttpError } from "@/server/auth/require-session";
import type { FormPermission } from "./forms-permissions";
import { requireFormPermission } from "./require-forms";

export async function requireFormsPageFrom<T>(
  verify: () => Promise<T>,
  redirectTo: (path: string) => never,
  requestedPath = "/order-system",
) {
  try {
    return await verify();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const next = encodeURIComponent(safeAuthReturnPath(requestedPath, "/order-system"));
      return redirectTo(`/order-system/sign-in?next=${next}`);
    }
    if (error instanceof HttpError && error.status === 403) {
      return redirectTo("/account");
    }
    throw error;
  }
}

export function requireFormsPage(
  requestedPath = "/order-system",
  permission: FormPermission = "access_forms",
) {
  return requireFormsPageFrom(
    () => requireFormPermission(permission),
    redirect,
    requestedPath,
  );
}
