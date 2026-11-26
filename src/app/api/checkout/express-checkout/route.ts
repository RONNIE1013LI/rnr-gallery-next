import { expressCheckoutAvailable } from "@/server/checkout/express-checkout-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market");
  const enabled = (market === "NZ" || market === "AU") && await expressCheckoutAvailable(market);
  return Response.json({ enabled }, { headers: { "Cache-Control": "no-store" } });
}
