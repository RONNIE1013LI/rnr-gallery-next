export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type SessionGetter<T> = (context: { headers: Headers }) => Promise<T | null>;

export async function requireSessionFrom<T>(
  getSession: SessionGetter<T>,
  requestHeaders: Headers,
): Promise<T> {
  const session = await getSession({ headers: requestHeaders });
  if (!session) throw new HttpError("Unauthorized", 401);
  return session;
}

export async function requireSession() {
  const [{ headers }, { auth }] = await Promise.all([
    import("next/headers"),
    import("@/server/auth"),
  ]);

  return requireSessionFrom(auth.api.getSession, await headers());
}
