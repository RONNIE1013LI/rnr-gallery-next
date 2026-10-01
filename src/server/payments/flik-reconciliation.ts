import type { FlikRepository, FlikSessionRecord } from "./flik-repository";
import type { createFlikSessionService } from "./flik-session-service";
import { flikPaymentResult } from "./flik-session-service";
import type { VerifiedPaymentResult } from "./types";

export function createFlikReconciliation({ repository, sessions, testMode, applyLiveResult, deadlineMs = Date.now() + 45_000, now = Date.now }: {
  repository: FlikRepository;
  sessions: ReturnType<typeof createFlikSessionService>;
  testMode: boolean;
  deadlineMs?: number;
  now?: () => number;
  applyLiveResult: (attemptId: string, result: VerifiedPaymentResult) => Promise<void>;
}) {
  async function reconcile(row: FlikSessionRecord) {
    if (row.testMode !== testMode) throw new Error("Flik mode mismatch");
    if (!row.providerReference) {
      // Recover an uncertain creation with the original key and body within the provider's window.
      row = await sessions.start(row);
      if (!row.providerReference) return false;
    }
    const session = await sessions.retrieve(row);
    if (row.testMode) {
      if (row.orderId || row.paymentAttemptId) throw new Error("Test payment has a commerce target");
    } else {
      if (!row.orderId || row.paymentAttemptId !== row.id) throw new Error("Missing payment target");
      await repository.recoverLiveAttemptBinding(row.id);
      await applyLiveResult(row.id, flikPaymentResult(row, session));
    }
    if (session.status === "completed" || session.status === "expired") {
      await repository.markSessionApplied(row.id, session.id);
    }
    return true;
  }
  return {
    async run() {
      const result = { processed: 0, confirmed: 0, pending: 0 };
      const visited = new Set<string>();
      for (const event of await repository.listPendingWebhooks(20)) {
        if (now() >= deadlineMs) break;
        try {
          const row = await repository.findSession(event.foreignTransactionId);
          if (!row || (row.providerReference && row.providerReference !== event.checkoutSessionId)) {
            await repository.deferWebhook(event.transactionId);
            continue;
          }
          // This read is against our saved session, never an arbitrary callback transaction.
          if (!row.providerReference) { await repository.deferWebhook(event.transactionId); continue; }
          visited.add(row.id);
          result.processed++;
          if (await reconcile(row)) {
            await repository.markWebhookProcessed(event.transactionId);
            result.confirmed++;
          } else result.pending++;
        } catch {
          result.pending++;
          await repository.deferWebhook(event.transactionId);
        }
      }
      for (const row of await repository.listPendingSessions(20)) {
        if (now() >= deadlineMs) break;
        if (visited.has(row.id)) continue;
        result.processed++;
        try { if (await reconcile(row)) result.confirmed++; else result.pending++; }
        catch { result.pending++; }
        await repository.deferSession(row.id);
      }
      return result;
    },
  };
}
