import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createWebsiteReviewAlertCronHandler } from "./route-handler";

export const runtime = "nodejs";

function unavailable() {
  return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
}

async function handle(request: Request) {
  const customerService = createCustomerServiceRuntime();
  if (!customerService.reviewAlertService || !customerService.config.websiteEnabled) return unavailable();
  return createWebsiteReviewAlertCronHandler({
    secret: customerService.config.turnRecoverySecret,
    deliverNext: customerService.reviewAlertService.deliverNext,
  })(request);
}

export const GET = handle;
export const POST = handle;
