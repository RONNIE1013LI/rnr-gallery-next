import { createFlikClient } from "./flik-client";
import { getDatabase } from "@/server/db/client";
import { parsePaymentConfig } from "./config";
import { createDrizzleFlikRepository } from "./flik-repository";
import { createFlikSessionService } from "./flik-session-service";

export function createFlikRuntime(options: { deadlineMs?: number } = {}) {
  const payment = parsePaymentConfig();
  if (!payment.flik?.enabled || !payment.operations.returnBaseUrl) return null;
  const config = payment.flik;
  const repository = createDrizzleFlikRepository(getDatabase());
  return { config, repository, sessions: createFlikSessionService({ config, repository, client: createFlikClient(config, options) }),
    returnOrigin: payment.operations.returnBaseUrl };
}
