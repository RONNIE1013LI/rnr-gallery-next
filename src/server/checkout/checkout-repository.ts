import { createCheckoutSessionToken, hashCheckoutSessionToken } from "./session-cookie";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export type CheckoutSessionRecord = Readonly<{
  id: string;
  tokenDigest: string;
  customerId: string | null;
  expiresAt: Date;
}>;

export type CheckoutUploadInput = Readonly<{
  id: string;
  checkoutSessionId: string;
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type CheckoutUploadRecord = CheckoutUploadInput &
  Readonly<{ createdAt: Date }>;

export interface CheckoutRepository {
  findActiveSessionByTokenDigest(
    tokenDigest: string,
    now: Date,
  ): Promise<CheckoutSessionRecord | null>;
  createSession(input: {
    tokenDigest: string;
    customerId: string | null;
    expiresAt: Date;
  }): Promise<CheckoutSessionRecord>;
  bindGuestSessionToCustomer(
    sessionId: string,
    customerId: string,
  ): Promise<CheckoutSessionRecord | null>;
  createUpload(input: CheckoutUploadInput): Promise<CheckoutUploadRecord>;
  findOwnedUploadIds(sessionId: string, uploadIds: string[]): Promise<string[]>;
}

export class UnownedUploadReferenceError extends Error {
  constructor() {
    super("One or more uploads do not belong to this checkout session");
    this.name = "UnownedUploadReferenceError";
  }
}

export async function ensureCheckoutSession({
  repository,
  rawToken,
  customerId,
  now = new Date(),
  createToken = createCheckoutSessionToken,
}: {
  repository: CheckoutRepository;
  rawToken: string | null;
  customerId: string | null;
  now?: Date;
  createToken?: () => string;
}): Promise<{
  session: CheckoutSessionRecord;
  cookieToken: string | null;
}> {
  const existing = rawToken
    ? await repository.findActiveSessionByTokenDigest(
        hashCheckoutSessionToken(rawToken),
        now,
      )
    : null;

  if (existing?.customerId === customerId) {
    return { session: existing, cookieToken: null };
  }

  if (existing?.customerId === null && customerId !== null) {
    const bound = await repository.bindGuestSessionToCustomer(
      existing.id,
      customerId,
    );
    if (bound) return { session: bound, cookieToken: null };
  }

  const token = createToken();
  const session = await repository.createSession({
    tokenDigest: hashCheckoutSessionToken(token),
    customerId,
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
  });
  return { session, cookieToken: token };
}

export async function assertOwnedUploadReferences(
  repository: CheckoutRepository,
  sessionId: string,
  uploadIds: string[],
): Promise<void> {
  if (uploadIds.length === 0) return;
  const uniqueIds = [...new Set(uploadIds)];
  const ownedIds = await repository.findOwnedUploadIds(sessionId, uniqueIds);
  if (ownedIds.length !== uniqueIds.length) {
    throw new UnownedUploadReferenceError();
  }
}
