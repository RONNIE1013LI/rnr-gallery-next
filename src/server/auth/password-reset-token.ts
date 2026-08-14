import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { verification } from "@/server/db/schema/auth";

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
  const database = getDatabase();
  return validatePasswordResetToken(token, async (identifier) => {
    const [record] = await database
      .select({ expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .limit(1);
    return record ?? null;
  });
}
