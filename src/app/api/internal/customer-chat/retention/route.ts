import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createWebsiteRetentionCronHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: Request) {
  const config = parseCustomerServiceConfig();
  if (!config.websiteEnabled) return new Response(null, { status: 404 });
  return createWebsiteRetentionCronHandler({
    secret: config.turnRecoverySecret,
    run: (input) => createCustomerServiceRuntime().repository.runWebsiteRetention(input),
  })(request);
}

export const GET = handle;
export const POST = handle;
