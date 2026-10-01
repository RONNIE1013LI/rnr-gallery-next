import { createFlikClient } from "./flik-client";
import { getDatabase } from "@/server/db/client";
import { parsePaymentConfig } from "./config";
import { createDrizzleFlikRepository } from "./flik-repository";
import { createFlikSessionService } from "./flik-session-service";

export async function createFlikRuntime(options: { deadlineMs?: number } = {}) {
  const payment = parsePaymentConfig();
  if (!payment.flik?.enabled || !payment.operations.returnBaseUrl) return null;
  const config = payment.flik;
  if (!config.testMode) {
    const { canReconcileFlikPayments } = await import("./flik-checkout-access");
    if (!await canReconcileFlikPayments()) return null;
  }
  const repository = createDrizzleFlikRepository(getDatabase());
  return { config, repository, sessions: createFlikSessionService({ config, repository, client: createFlikClient(config, options) }),
    returnOrigin: payment.operations.returnBaseUrl };
}
