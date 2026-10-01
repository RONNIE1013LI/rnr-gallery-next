import type { EnabledFlikConfig } from "./flik-config";
import { createFlikClient, type FlikRetrievedSession } from "./flik-client";
import type { FlikRepository, FlikSessionRecord, FlikSessionSnapshot } from "./flik-repository";
import type { VerifiedPaymentResult } from "./types";

export function flikPaymentResult(row: FlikSessionRecord, session: FlikRetrievedSession): VerifiedPaymentResult {
  return {
    providerReference: session.id, providerStatus: session.status,
    amountCents: session.amountCents, currency: session.currency,
    orderNumber: row.merchantReference, merchantReference: row.merchantReference,
    foreignTransactionId: session.foreignTransactionId, testMode: session.testMode,
    // A failed bank attempt can still succeed in this same session. Never release the order early.
    status: session.status === "completed" ? "paid" : session.status === "expired" ? "cancelled" : "processing",
  };
}

export function createFlikSessionService({ config, repository, client = createFlikClient(config) }: {
  config: EnabledFlikConfig;
  repository: FlikRepository;
  client?: ReturnType<typeof createFlikClient>;
}) {
  const snapshot = (row: FlikSessionRecord) => {
    if (row.testMode !== config.testMode || row.currency !== "NZD" || row.market !== "NZ") {
      throw new Error("Flik environment or snapshot mismatch");
    }
    return { attemptId: row.id, amountCents: row.expectedAmountCents, currency: "NZD" as const, testMode: row.testMode };
  };
  return {
    async start(input: FlikSessionSnapshot): Promise<FlikSessionRecord> {
      const row = await repository.createOrGetSession(input);
      snapshot(row);
      if (row.providerReference) return row;
      const claim = await repository.claimSessionCreation(row.id);
      if (!claim.claimId) return claim.session;
      try {
        const session = await client.createSession({
          snapshot: snapshot(row), reference: row.id.replaceAll("-", "").slice(0, 12),
          redirectUrl: row.returnUrl, webhookUrl: row.webhookUrl,
        });
        // Persist the only copy of the opaque payer URL before any follow-up API call.
        return await repository.bindSession({ id: row.id, claimId: claim.claimId,
          providerReference: session.id, hostedUrl: session.url, expiresAt: new Date(session.expiresAt) });
      } catch (error) {
        // Unknown outcomes retain the same durable idempotency key/body; no failed payment is inferred.
        await repository.releaseSessionCreation(row.id, claim.claimId);
        throw error;
      }
    },
    async retrieve(row: FlikSessionRecord) {
      if (!row.providerReference) throw new Error("Flik payment is awaiting confirmation");
      const session = await client.retrieveSession(row.providerReference, snapshot(row));
      const known = ["created", "pending", "failed", "expired", "completed"].includes(session.status);
      await repository.updateVerifiedSession(row.id, session.id, known ? session.status : "unknown");
      return session;
    },
  };
}
