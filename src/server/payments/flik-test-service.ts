import type { FlikConfig } from "./flik-config";
import type { FlikRepository, FlikSessionRecord, FlikSessionSnapshot } from "./flik-repository";
import type { createFlikSessionService } from "./flik-session-service";

export type FlikTestResult = Readonly<{
  id: string;
  status: "created" | "pending" | "failed" | "expired" | "completed";
  redirectUrl?: string;
}>;
export class FlikTestAccessError extends Error {
  constructor(readonly status: 404 | 503) {
    super(status === 404 ? "Test payment was not found" : "Isolated Flik testing is unavailable");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createFlikTestService({ config, repository, sessionService, returnOrigin }: {
  config: FlikConfig;
  repository: FlikRepository;
  sessionService: ReturnType<typeof createFlikSessionService>;
  returnOrigin: string;
}) {
  function assertAvailable() {
    if (!config.enabled || !config.testMode || config.mode !== "test" || config.deployment !== "development") throw new FlikTestAccessError(503);
    let origin: URL;
    try { origin = new URL(returnOrigin); } catch { throw new FlikTestAccessError(503); }
    if (origin.origin !== returnOrigin || origin.protocol !== "https:" || origin.username || origin.password) throw new FlikTestAccessError(503);
  }
  function assertOwner(row: FlikSessionRecord | null, adminId: string): asserts row is FlikSessionRecord {
    if (!row || row.adminUserId !== adminId || !row.testMode || row.orderId !== null || row.paymentAttemptId !== null) throw new FlikTestAccessError(404);
  }
  function result(row: FlikSessionRecord, status = row.providerStatus): FlikTestResult {
    const known = ["created", "pending", "failed", "expired", "completed"].includes(status)
      ? status as FlikTestResult["status"] : "pending";
    return { id: row.id, status: known, ...(row.hostedUrl && ["created", "pending", "failed"].includes(known) ? { redirectUrl: row.hostedUrl } : {}) };
  }
  return {
    async start(adminId: string, idempotencyKey: string): Promise<FlikTestResult> {
      assertAvailable();
      if (!adminId.trim() || !uuid.test(idempotencyKey)) throw new FlikTestAccessError(404);
      const existing = await repository.findSession(idempotencyKey);
      if (existing) assertOwner(existing, adminId);
      const snapshot: FlikSessionSnapshot = {
        id: idempotencyKey, idempotencyKey, paymentAttemptId: null, orderId: null,
        adminUserId: adminId, testMode: true, market: "NZ", currency: "NZD",
        billingCountry: "NZ", deliveryCountry: "NZ", expectedAmountCents: 100,
        merchantReference: `TEST-${idempotencyKey}`,
        returnUrl: `${returnOrigin}/admin/settings/payment/flik?sessionId=${idempotencyKey}`,
        webhookUrl: `${returnOrigin}/api/payments/webhooks/flik`,
      };
      try { return result(await sessionService.start(snapshot)); }
      catch (error) {
        // Creation may have reached Flik. Retain the same saved key for an explicit retry.
        const saved = await repository.findSession(idempotencyKey);
        if (!saved) throw error;
        assertOwner(saved, adminId);
        return result(saved, "pending");
      }
    },
    async confirm(adminId: string, id: string): Promise<FlikTestResult> {
      assertAvailable();
      if (!uuid.test(id)) throw new FlikTestAccessError(404);
      const row = await repository.findSession(id);
      assertOwner(row, adminId);
      if (!row.providerReference) return result(row, "pending");
      try {
        const session = await sessionService.retrieve(row);
        if (!session.testMode || session.currency !== row.currency || session.amountCents !== row.expectedAmountCents || session.foreignTransactionId !== row.id || session.id !== row.providerReference) {
          return result(row, "pending");
        }
        if (session.status === "completed" || session.status === "expired") {
          await repository.markSessionApplied(row.id, session.id);
        }
        return result(row, session.status);
      } catch {
        // No order, email, fulfilment, revenue or advertising service is involved.
        return result(row, "pending");
      }
    },
  };
}
