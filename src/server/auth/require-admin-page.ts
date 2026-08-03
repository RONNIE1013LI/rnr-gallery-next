import { redirect } from "next/navigation";
import { requireAdmin } from "./require-admin";
import { HttpError } from "./require-session";

export async function requireAdminPageFrom<T>(
  verify: () => Promise<T>,
  redirectTo: (path: string) => never,
) {
  try {
    return await verify();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return redirectTo("/account/sign-in?next=/admin/design-gallery");
    }
    if (error instanceof HttpError && error.status === 403) {
      return redirectTo("/account");
    }
    throw error;
  }
}

export function requireAdminPage() {
  return requireAdminPageFrom(requireAdmin, redirect);
}
