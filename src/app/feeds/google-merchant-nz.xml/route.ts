import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { createGoogleMerchantFeedRoute } from "@/server/merchant/google-merchant-feed";
import { getSiteUrl } from "@/server/seo/site-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const route = createGoogleMerchantFeedRoute({
  market: "NZ",
  current: getSafePublicProductRegistry,
  siteUrl: getSiteUrl(),
});

export const GET = route.GET;
