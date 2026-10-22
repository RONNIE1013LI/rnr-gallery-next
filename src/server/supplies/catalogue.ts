import { asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import type { SuppliesCatalogue, SupplyImage } from "@/domain/supplies/types";
import { publicSuppliesCatalogue, validateSupplyPurchase } from "@/domain/supplies/catalogue-policy";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { cachePublicData, PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";
import { getDatabase } from "@/server/db/client";
import { suppliesCategories, suppliesImages, suppliesProducts, suppliesSettings, suppliesVariants } from "@/server/db/schema/supplies";
import { isMissingSuppliesSchema, SuppliesSchemaPendingError } from "./errors";
import { releaseAbandonedSupplyReservations } from "./reservation-expiry";

export type SuppliesReadDatabase = Pick<ReturnType<typeof getDatabase>, "select">;
export const SUPPLIES_PUBLIC_CACHE_TAGS = [PUBLIC_CACHE_TAGS.content, PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap] as const;

export function supplyImageDto(image: typeof suppliesImages.$inferSelect, admin = false): SupplyImage {
  return {
    id: image.id, productId: image.productId, categoryId: image.categoryId, storageKey: image.storageKey,
    url: `/api/${admin ? "admin/" : ""}supplies/images/${image.id}`,
    altText: image.altText, width: image.width, height: image.height, sortOrder: image.sortOrder, isCover: image.isCover,
  };
}

/** Fresh reads only. Checkout can pass its transaction so catalogue and stock share the same boundary. */
export async function loadSuppliesCatalogue(database?: SuppliesReadDatabase): Promise<SuppliesCatalogue> {
  try {
    if (!database && !process.env.DATABASE_URL?.trim()) throw new SuppliesSchemaPendingError();
    const reader = database ?? getDatabase();
    const [settings] = await reader.select().from(suppliesSettings).where(eq(suppliesSettings.key, "primary")).limit(1);
    const [categories, products, variants, images] = await Promise.all([
      reader.select().from(suppliesCategories).orderBy(asc(suppliesCategories.sortOrder), asc(suppliesCategories.name)),
      reader.select().from(suppliesProducts).orderBy(asc(suppliesProducts.sortOrder), asc(suppliesProducts.title)),
      reader.select().from(suppliesVariants).where(eq(suppliesVariants.archived, false)).orderBy(asc(suppliesVariants.sortOrder)),
      reader.select().from(suppliesImages).where(isNull(suppliesImages.detachedAt)).orderBy(asc(suppliesImages.sortOrder)),
    ]);
    return {
      settings: { enabled: settings?.enabled ?? false, updatedAt: settings?.updatedAt.toISOString() ?? null, updatedBy: settings?.updatedBy ?? null },
      categories: categories.map((category) => ({ ...category, image: images.find((image) => image.categoryId === category.id) ? supplyImageDto(images.find((image) => image.categoryId === category.id)!) : null })),
      products: products.map((product) => ({
        ...product, variants: variants.filter((variant) => variant.productId === product.id),
        images: images.filter((image) => image.productId === product.id).map((image) => supplyImageDto(image)),
      })),
    };
  } catch (error) {
    if (isMissingSuppliesSchema(error)) throw new SuppliesSchemaPendingError();
    throw error;
  }
}

async function loadPublicCatalogue() {
  if (!process.env.DATABASE_URL?.trim()) return null;
  try { return publicSuppliesCatalogue(await loadSuppliesCatalogue()); }
  catch (error) { if (error instanceof SuppliesSchemaPendingError) return null; throw error; }
}

// Only filtered public data enters shared cache. Admin and checkout reads never use this function.
const cachedPublicCatalogue = cachePublicData(loadPublicCatalogue, "supplies-catalogue-v1", SUPPLIES_PUBLIC_CACHE_TAGS);
async function loadCurrentPublicEnabled() {
  if (!process.env.DATABASE_URL?.trim()) return false;
  try {
    const [settings] = await getDatabase().select({ enabled: suppliesSettings.enabled }).from(suppliesSettings).where(eq(suppliesSettings.key, "primary")).limit(1);
    return settings?.enabled === true;
  } catch (error) { if (isMissingSuppliesSchema(error)) return false; throw error; }
}
const readCurrentPublicEnabled = cache(loadCurrentPublicEnabled);
// Display data is shared across requests; catalogue and checkout guards remain fresh.
const readPublicDisplayEnabled = cachePublicData(loadCurrentPublicEnabled, "supplies-display-enabled-v1", SUPPLIES_PUBLIC_CACHE_TAGS);
const recoverPublicReservations = cache(releaseAbandonedSupplyReservations);
export async function getPublicSuppliesCatalogue() {
  // The fresh switch guard makes an OFF change effective even if catalogue invalidation failed.
  if (!await readCurrentPublicEnabled()) return null;
  await recoverPublicReservations();
  return cachedPublicCatalogue();
}
export async function isSuppliesStoreEnabled() { return readPublicDisplayEnabled(); }
export async function getPublicSupplyProduct(slug: string) { return (await getPublicSuppliesCatalogue())?.products.find((product) => product.slug === slug) ?? null; }
export async function getPublicSupplyCategory(slug: string) { return (await getPublicSuppliesCatalogue())?.categories.find((category) => category.slug === slug) ?? null; }
export async function getPublicSupplyImage(id: string) {
  const catalogue = await getPublicSuppliesCatalogue();
  return catalogue?.products.flatMap((product) => product.images).find((image) => image.id === id)
    ?? catalogue?.categories.map((category) => category.image).find((image) => image?.id === id) ?? null;
}

export async function getAdminSuppliesCatalogue(includeDrafts = true): Promise<SuppliesCatalogue> {
  await requireAdminPermission("manage_content");
  const catalogue = await loadSuppliesCatalogue();
  return {
    ...catalogue,
    categories: catalogue.categories.filter((category) => includeDrafts || (category.visible && !category.archived))
      .map((category) => ({ ...category, image: category.image ? { ...category.image, url: `/api/admin/supplies/images/${category.image.id}` } : null })),
    products: catalogue.products.filter((product) => includeDrafts || (product.status === "published" && catalogue.categories.some((category) => category.id === product.categoryId && category.visible && !category.archived)))
      .map((product) => ({ ...product, images: product.images.map((image) => ({ ...image, url: `/api/admin/supplies/images/${image.id}` })) })),
  };
}
export async function getAdminSupplyProduct(id: string) { return (await getAdminSuppliesCatalogue()).products.find((product) => product.id === id) ?? null; }
export async function getPurchasableSupply(productId: string, variantId?: string | null, options: { database?: SuppliesReadDatabase; allowReservedStock?: boolean } = {}) {
  try { return validateSupplyPurchase(await loadSuppliesCatalogue(options.database), productId, variantId, options); }
  catch (error) { if (error instanceof SuppliesSchemaPendingError) return null; throw error; }
}
