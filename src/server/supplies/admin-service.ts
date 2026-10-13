import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { HttpError } from "@/server/auth/require-session";
import { suppliesAuditLogs, suppliesCategories, suppliesImages, suppliesProducts, suppliesSettings, suppliesVariants } from "@/server/db/schema/supplies";
import { supplyImageDto } from "./catalogue";
import { persistSupplyImage } from "./media";
import { parseSupplyCategoryInput, parseSupplyProductInput, SuppliesValidationError } from "./validation";
import { SuppliesSchemaPendingError } from "./errors";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type SuppliesActor = Readonly<{ userId: string; canPublish?: boolean; canDeleteMedia?: boolean }>;

export function requireSupplyId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new SuppliesValidationError("Invalid supplies ID", 404);
  return id;
}

export function assertUnchangedSupplyStock(before: { trackInventory: boolean; stockQuantity: number | null }, input: { trackInventory: boolean; expectedStockQuantity?: number | null }) {
  if ((before.trackInventory || input.trackInventory) && input.expectedStockQuantity !== before.stockQuantity) {
    throw new SuppliesValidationError("Stock changed while this editor was open. Refresh before saving.", 409);
  }
}

export function parseSupplyImageAltText(value: string) {
  const text = value.trim();
  if (!text || text.length > 300) throw new SuppliesValidationError("Image alt text must contain 1 to 300 characters");
  return text;
}

async function lockImageOwner(tx: Transaction, owner: { productId?: string; categoryId?: string }, actor: SuppliesActor) {
  if (owner.productId) {
    const [product] = await tx.select().from(suppliesProducts).where(eq(suppliesProducts.id, owner.productId)).for("update");
    if (!product) throw new SuppliesValidationError("Product not found", 404);
    if (product.status === "published" && !actor.canPublish) throw new HttpError("Publication permission is required", 403);
  } else {
    const [category] = await tx.select().from(suppliesCategories).where(eq(suppliesCategories.id, owner.categoryId!)).for("update");
    if (!category) throw new SuppliesValidationError("Category not found", 404);
    if (category.visible && !category.archived && !actor.canPublish) throw new HttpError("Publication permission is required", 403);
  }
}

async function audit(tx: Transaction, actor: SuppliesActor, action: string, resourceType: string, resourceId: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  await tx.insert(suppliesAuditLogs).values({ actorUserId: actor.userId, action, resourceType, resourceId, beforeSummary: before, afterSummary: after });
}

export function createSuppliesAdminService(inputDatabase?: Database) {
  if (!inputDatabase && !process.env.DATABASE_URL?.trim()) throw new SuppliesSchemaPendingError();
  const database = inputDatabase ?? getDatabase();
  return {
    async saveCategory(actor: SuppliesActor, body: unknown, id?: string) {
      const input = parseSupplyCategoryInput(body);
      if (id) requireSupplyId(id);
      return database.transaction(async (tx) => {
        const [before] = id ? await tx.select().from(suppliesCategories).where(eq(suppliesCategories.id, id)).for("update") : [];
        if (id && !before) throw new SuppliesValidationError("Category not found", 404);
        const [category] = id
          ? await tx.update(suppliesCategories).set(input).where(eq(suppliesCategories.id, id)).returning()
          : await tx.insert(suppliesCategories).values(input).returning();
        await audit(tx, actor, id ? "category.update" : "category.create", "supplies_category", category.id, before ?? null, category);
        return category.id;
      });
    },
    async archiveCategory(actor: SuppliesActor, id: string) {
      requireSupplyId(id);
      await database.transaction(async (tx) => {
        const [before] = await tx.select().from(suppliesCategories).where(eq(suppliesCategories.id, id)).for("update");
        if (!before) throw new SuppliesValidationError("Category not found", 404);
        const [after] = await tx.update(suppliesCategories).set({ archived: true, visible: false }).where(eq(suppliesCategories.id, id)).returning();
        await audit(tx, actor, "category.archive", "supplies_category", id, before, after);
      });
    },
    async saveProduct(actor: SuppliesActor, body: unknown, id?: string) {
      const input = parseSupplyProductInput(body);
      if (id) requireSupplyId(id);
      return database.transaction(async (tx) => {
        // Serialize cross-table SKU checks; per-table unique indexes cannot protect product vs variant collisions.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rnr-supplies-product-skus'))`);
        const [category] = await tx.select().from(suppliesCategories).where(eq(suppliesCategories.id, input.categoryId)).for("share");
        if (!category) throw new SuppliesValidationError("Choose an existing category");
        if (input.status === "published" && (!category.visible || category.archived)) throw new SuppliesValidationError("Published products need a visible, active category");
        const [before] = id ? await tx.select().from(suppliesProducts).where(eq(suppliesProducts.id, id)).for("update") : [];
        if (id && !before) throw new SuppliesValidationError("Product not found", 404);
        if (before) assertUnchangedSupplyStock(before, input);
        const productSkuVariants = await tx.select({ id: suppliesVariants.id }).from(suppliesVariants).where(sql`lower(${suppliesVariants.sku}) = ${input.sku.toLowerCase()}`).limit(1);
        if (productSkuVariants.length) throw new SuppliesValidationError("A product or variant SKU already exists", 409);
        for (const variant of input.variants) {
          const duplicateProducts = await tx.select({ id: suppliesProducts.id }).from(suppliesProducts).where(sql`lower(${suppliesProducts.sku}) = ${variant.sku.toLowerCase()}`).limit(1);
          if (duplicateProducts.length) throw new SuppliesValidationError("A product or variant SKU already exists", 409);
        }
        const { variants, expectedStockQuantity: _, ...fields } = input;
        void _;
        const [product] = id
          ? await tx.update(suppliesProducts).set(fields).where(eq(suppliesProducts.id, id)).returning()
          : await tx.insert(suppliesProducts).values(fields).returning();
        const existing = await tx.select().from(suppliesVariants).where(eq(suppliesVariants.productId, product.id)).for("update");
        const existingIds = new Set(existing.map((item) => item.id));
        for (const variant of variants) {
          if (variant.id && !existingIds.has(variant.id)) throw new SuppliesValidationError("Variant does not belong to this product");
          const previous = variant.id ? existing.find((item) => item.id === variant.id) : undefined;
          if (previous) assertUnchangedSupplyStock(previous, variant);
          const { id: variantId, expectedStockQuantity: expectedStock, ...variantFields } = variant;
          void expectedStock;
          if (variantId) await tx.update(suppliesVariants).set({ ...variantFields, archived: false }).where(eq(suppliesVariants.id, variantId));
          else await tx.insert(suppliesVariants).values({ ...variantFields, productId: product.id });
        }
        const retainedIds = new Set(variants.flatMap((variant) => variant.id ? [variant.id] : []));
        const removed = existing.filter((variant) => !retainedIds.has(variant.id)).map((variant) => variant.id);
        // Preserve IDs referenced by historical orders/reservations; removed variants become unavailable.
        if (removed.length) await tx.update(suppliesVariants).set({ active: false, available: false, archived: true }).where(inArray(suppliesVariants.id, removed));
        await audit(tx, actor, id ? "product.update" : "product.create", "supplies_product", product.id, before ? { ...before, variants: existing } : null, { ...product, variants });
        return product.id;
      });
    },
    async archiveProduct(actor: SuppliesActor, id: string) {
      requireSupplyId(id);
      await database.transaction(async (tx) => {
        const [before] = await tx.select().from(suppliesProducts).where(eq(suppliesProducts.id, id)).for("update");
        if (!before) throw new SuppliesValidationError("Product not found", 404);
        const [after] = await tx.update(suppliesProducts).set({ status: "archived", available: false }).where(eq(suppliesProducts.id, id)).returning();
        await audit(tx, actor, "product.archive", "supplies_product", id, before, after);
      });
    },
    async saveSettings(actor: SuppliesActor, body: unknown) {
      const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(body);
      if (!parsed.success) throw new SuppliesValidationError("Choose an explicit store enabled state");
      return database.transaction(async (tx) => {
        // Serialize the first singleton creation as well as subsequent switch changes.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rnr-supplies-settings'))`);
        const [before] = await tx.select().from(suppliesSettings).where(eq(suppliesSettings.key, "primary")).for("update");
        const [after] = await tx.insert(suppliesSettings).values({ key: "primary", enabled: parsed.data.enabled, updatedBy: actor.userId })
          .onConflictDoUpdate({ target: suppliesSettings.key, set: { enabled: parsed.data.enabled, updatedBy: actor.userId, updatedAt: new Date() } }).returning();
        await audit(tx, actor, "store.visibility", "supplies_settings", "primary", before ?? { enabled: false }, after);
        return { enabled: after.enabled, updatedAt: after.updatedAt.toISOString(), updatedBy: after.updatedBy };
      });
    },
    async uploadImage(actor: SuppliesActor, owner: { productId?: string; categoryId?: string }, input: { bytes: Uint8Array; mimeType: string; altText: string }) {
      const ownerId = requireSupplyId(owner.productId ?? owner.categoryId ?? "");
      const altText = parseSupplyImageAltText(input.altText);
      // Validate persistence/readiness before creating a blob. Race-safe ownership is checked again in the transaction.
      const exists = owner.productId
        ? await database.select({ id: suppliesProducts.id }).from(suppliesProducts).where(eq(suppliesProducts.id, ownerId))
        : await database.select({ id: suppliesCategories.id }).from(suppliesCategories).where(eq(suppliesCategories.id, ownerId));
      if (!exists.length) throw new SuppliesValidationError("Image owner not found", 404);
      const stored = await persistSupplyImage(ownerId, input.bytes, input.mimeType);
      return database.transaction(async (tx) => {
        await lockImageOwner(tx, owner, actor);
        const ownerCondition = owner.productId ? eq(suppliesImages.productId, ownerId) : eq(suppliesImages.categoryId, ownerId);
        const existing = await tx.select().from(suppliesImages).where(and(ownerCondition, isNull(suppliesImages.detachedAt))).for("update");
        if (existing.length >= 20 && owner.productId) throw new SuppliesValidationError("A product can contain at most 20 images");
        if (owner.categoryId && existing.length) {
          if (!actor.canDeleteMedia) throw new HttpError("Media deletion permission is required", 403);
          await tx.update(suppliesImages).set({ categoryId: null, isCover: false, detachedAt: new Date() }).where(ownerCondition);
        }
        const [image] = await tx.insert(suppliesImages).values({ id: randomUUID(), productId: owner.productId ?? null, categoryId: owner.categoryId ?? null, altText, ...stored, sortOrder: existing.length, isCover: !!owner.categoryId || !existing.length }).returning();
        await audit(tx, actor, "image.upload", owner.productId ? "supplies_product" : "supplies_category", ownerId, { images: existing.map((item) => item.id) }, { imageId: image.id });
        return supplyImageDto(image, true);
      });
    },
    async reorderImages(actor: SuppliesActor, productId: string, body: unknown) {
      requireSupplyId(productId);
      const parsed = z.object({ images: z.array(z.object({ id: z.uuid(), altText: z.string().trim().min(1).max(300), sortOrder: z.number().int().min(0).max(100_000), isCover: z.boolean() }).strict()).max(20) }).strict().safeParse(body);
      if (!parsed.success) throw new SuppliesValidationError("Invalid image order or alt text");
      const layout = parsed.data.images;
      if (new Set(layout.map((image) => image.id)).size !== layout.length || (layout.length > 0 && layout.filter((image) => image.isCover).length !== 1)) throw new SuppliesValidationError("Select one cover and include each image exactly once");
      await database.transaction(async (tx) => {
        await lockImageOwner(tx, { productId }, actor);
        const existing = await tx.select().from(suppliesImages).where(and(eq(suppliesImages.productId, productId), isNull(suppliesImages.detachedAt))).for("update");
        if (existing.length !== layout.length || existing.some((image) => !layout.some((item) => item.id === image.id))) throw new SuppliesValidationError("Image layout must include all current product images");
        await tx.update(suppliesImages).set({ isCover: false }).where(eq(suppliesImages.productId, productId));
        for (const image of layout) await tx.update(suppliesImages).set({ altText: image.altText, sortOrder: image.sortOrder, isCover: image.isCover }).where(eq(suppliesImages.id, image.id));
        await audit(tx, actor, "images.layout", "supplies_product", productId, { images: existing }, { images: layout });
      });
    },
    async detachImage(actor: SuppliesActor, owner: { productId?: string; categoryId?: string }, imageId?: string) {
      const ownerId = requireSupplyId(owner.productId ?? owner.categoryId ?? "");
      if (imageId) requireSupplyId(imageId);
      await database.transaction(async (tx) => {
        await lockImageOwner(tx, owner, actor);
        if (!actor.canDeleteMedia) throw new HttpError("Media deletion permission is required", 403);
        const ownerCondition = owner.productId ? eq(suppliesImages.productId, ownerId) : eq(suppliesImages.categoryId, ownerId);
        const [image] = await tx.select().from(suppliesImages).where(and(ownerCondition, isNull(suppliesImages.detachedAt), imageId ? eq(suppliesImages.id, imageId) : undefined)).for("update");
        if (!image) throw new SuppliesValidationError("Image not found", 404);
        await tx.update(suppliesImages).set({ productId: null, categoryId: null, isCover: false, detachedAt: new Date() }).where(eq(suppliesImages.id, image.id));
        if (image.isCover && owner.productId) {
          const [next] = await tx.select().from(suppliesImages).where(and(ownerCondition, isNull(suppliesImages.detachedAt), ne(suppliesImages.id, image.id))).orderBy(suppliesImages.sortOrder).limit(1);
          if (next) await tx.update(suppliesImages).set({ isCover: true }).where(eq(suppliesImages.id, next.id));
        }
        // Detach only. Blob remains quarantined for audited orphan cleanup, never deleted while referenced.
        await audit(tx, actor, "image.detach", owner.productId ? "supplies_product" : "supplies_category", ownerId, { imageId: image.id }, { detached: true });
      });
    },
  };
}
