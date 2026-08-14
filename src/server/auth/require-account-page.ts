import { redirect } from "next/navigation";

import { safeAuthReturnPath } from "./safe-return-path";
import { HttpError, requireSession } from "./require-session";

export async function requireAccountPageFrom<T>(
  verify: () => Promise<T>,
  redirectTo: (path: string) => never,
  requestedPath = "/account",
) {
  try {
    return await verify();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const next = encodeURIComponent(safeAuthReturnPath(requestedPath, "/account"));
      return redirectTo(`/account/sign-in?next=${next}`);
    }
    throw error;
  }
}

export function requireAccountPage(requestedPath = "/account") {
  return requireAccountPageFrom(requireSession, redirect, requestedPath);
}
