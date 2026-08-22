import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createWebsiteRetentionCronHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: Request) {
  const customerService = createCustomerServiceRuntime();
  if (!customerService.config.websiteEnabled) return new Response(null, { status: 404 });
  return createWebsiteRetentionCronHandler({
    secret: customerService.config.turnRecoverySecret,
    run: (input) => customerService.repository.runWebsiteRetention(input),
  })(request);
}

export const GET = handle;
export const POST = handle;
