type SessionGetter<T> = (context: { headers: Headers }) => Promise<T | null>;

export function getOptionalSessionFrom<T>(
  getSession: SessionGetter<T>,
  requestHeaders: Headers,
): Promise<T | null> {
  return getSession({ headers: requestHeaders });
}

export async function getOptionalSession(requestHeaders?: Headers) {
  const { auth } = await import("@/server/auth");
  if (requestHeaders) {
    return getOptionalSessionFrom(auth.api.getSession, requestHeaders);
  }
  const { headers } = await import("next/headers");
  return getOptionalSessionFrom(auth.api.getSession, await headers());
}
