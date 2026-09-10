export type PasswordResetTokenStatus = "valid" | "invalid";
export type PasswordResetTokenFinder = (
  identifier: string,
) => Promise<Readonly<{ expiresAt: Date | string }> | null>;

const tokenPattern = /^[A-Za-z0-9_-]{8,512}$/;

export async function validatePasswordResetToken(
  token: string,
  findVerification: PasswordResetTokenFinder,
  now = new Date(),
): Promise<PasswordResetTokenStatus> {
  if (!tokenPattern.test(token)) return "invalid";
  const record = await findVerification(`reset-password:${token}`);
  if (!record) return "invalid";
  const expiresAt = record.expiresAt instanceof Date
    ? record.expiresAt
    : new Date(record.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime()
    ? "valid"
    : "invalid";
}

export function getPasswordResetTokenStatus(token: string) {
  return validatePasswordResetToken(token, async (identifier) => {
    // The auth adapter applies the configured identifier hashing without consuming the token.
    const { auth } = await import("@/server/auth");
    const context = await auth.$context;
    return context.internalAdapter.findVerificationValue(identifier);
  });
}
