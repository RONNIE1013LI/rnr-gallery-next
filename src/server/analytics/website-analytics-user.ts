import { getOptionalSession } from "@/server/auth/get-optional-session";

/** Identity is resolved per event, never from client input or a whole visitor/session. */
export async function getAnalyticsUserId(headers: Headers): Promise<string | null> {
  try {
    return (await getOptionalSession(headers))?.user.id ?? null;
  } catch {
    // An auth outage must not break anonymous analytics or the shopping experience.
    return null;
  }
}
