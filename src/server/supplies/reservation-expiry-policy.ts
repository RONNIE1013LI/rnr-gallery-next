export type SupplyReservationExpiryEvidence = Readonly<{
  status: string;
  expiresAt: Date;
  paymentStatus: string;
  attempts: readonly Readonly<{ status: string; providerReference: string | null; providerSessionLeaseExpiresAt: Date | null }>[];
  flikSessions: readonly Readonly<{ providerReference: string | null; appliedAt: Date | null; creationLeaseExpiresAt: Date | null }>[];
}>;
export const ABANDONED_SUPPLY_RESERVATION_MS = 30 * 60 * 1000;
export function canExpireSupplyReservation(evidence: SupplyReservationExpiryEvidence, now: Date): boolean {
  if (evidence.status !== "reserved" || ["paid", "refunded"].includes(evidence.paymentStatus) ||
      !Number.isFinite(evidence.expiresAt.getTime()) || evidence.expiresAt.getTime() > now.getTime()) return false;
  const liveAttempt = evidence.attempts.some((attempt) => ["created", "requires_action", "processing"].includes(attempt.status) &&
    (attempt.providerReference !== null || (attempt.providerSessionLeaseExpiresAt?.getTime() ?? 0) > now.getTime()));
  const liveFlik = evidence.flikSessions.some((session) => session.appliedAt === null &&
    (session.providerReference !== null || (session.creationLeaseExpiresAt?.getTime() ?? 0) > now.getTime()));
  return !liveAttempt && !liveFlik;
}
