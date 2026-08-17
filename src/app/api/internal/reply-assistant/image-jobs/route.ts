import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createImageJobRecoveryHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const customerService = createCustomerServiceRuntime();
  if (!customerService.imageJobRunner) return new Response(null, { status: 404 });
  return createImageJobRecoveryHandler({
    secret: customerService.config.imageJobRunnerSecret,
    runOnce: () => customerService.imageJobRunner!.runOnce(),
  })(request);
}
