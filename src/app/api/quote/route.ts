import { parseAuthConfig } from "@/server/auth/config";
import { productionQuoteRateLimit } from "@/server/enquiry/quote-rate-limit";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { createQuoteHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return await createQuoteHandler({
      trustedOrigin: parseAuthConfig().origin,
      provider: createResendEmailProvider({ RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM }),
      allowRequest: productionQuoteRateLimit(),
    })(request);
  } catch {
    return Response.json({ error: "The enquiry service is temporarily unavailable. Please try again or use one of our other contact options." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
