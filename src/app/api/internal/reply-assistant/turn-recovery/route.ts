import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createTurnRecoveryHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: Request) {
  const customerService = createCustomerServiceRuntime();
  if (!customerService.config.enabled && !customerService.config.websiteEnabled) {
    return new Response(null, { status: 404 });
  }
  return createTurnRecoveryHandler({
    secret: customerService.config.turnRecoverySecret,
    runOnce: () => customerService.turnRecoveryRunner.runOnce(),
  })(request);
}

export const GET = handle;
export const POST = handle;
