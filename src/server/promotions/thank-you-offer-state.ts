import { eq } from "drizzle-orm";
import { THANK_YOU_OFFER_CONTENT_KEY, THANK_YOU_OFFER_ENABLED } from "@/domain/promotions/thank-you-offer";
import { getDatabase } from "@/server/db/client";
import { contentEntries } from "@/server/db/schema";
import { cachePublicData, PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";

type Database = ReturnType<typeof getDatabase>;
type OfferDatabase = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

// Strict for admin reads; only a genuinely absent row uses the legacy default.
export async function getThankYouOfferState(database: OfferDatabase = getDatabase()): Promise<boolean> {
  const [row] = await database.select({ publishedValue: contentEntries.publishedValue })
    .from(contentEntries).where(eq(contentEntries.key, THANK_YOU_OFFER_CONTENT_KEY)).limit(1);
  return row ? row.publishedValue === "enabled" : THANK_YOU_OFFER_ENABLED;
}

// Quotes, voucher issuance and new-order claims always read authoritative state.
export async function isThankYouOfferEnabled(database?: OfferDatabase): Promise<boolean> {
  try {
    return await getThankYouOfferState(database ?? getDatabase());
  } catch {
    return false;
  }
}

const getCachedPublicState = cachePublicData(
  async () => getThankYouOfferState(),
  "thank-you-offer-enabled",
  [PUBLIC_CACHE_TAGS.content],
  60,
);

export async function getPublicThankYouOfferEnabled(): Promise<boolean> {
  try {
    return await getCachedPublicState();
  } catch {
    // Keep failures outside the cached loader so a transient failure is not cached.
    return false;
  }
}
