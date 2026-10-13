// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicSuppliesCatalogue } from "@/domain/supplies/catalogue-policy";
import { user } from "@/server/db/schema/auth";
import { suppliesAuditLogs, suppliesCategories, suppliesImages, suppliesProducts, suppliesSettings, suppliesVariants } from "@/server/db/schema/supplies";
import { createSuppliesAdminService } from "./admin-service";
import { loadSuppliesCatalogue } from "./catalogue";
import { getSupplyPurchaseService } from "./purchase-runtime";
import type { SupplyProductInput } from "./validation";

const databaseUrl = process.env.TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const database = pool ? drizzle(pool) : null;
const actor = { userId: `supplies-admin-fixture-${randomUUID()}`, canPublish: true, canDeleteMedia: true };
const categoryIds: string[] = [];
const productIds: string[] = [];
const imageIds: string[] = [];
let initialized = false;
let priorSettings: typeof suppliesSettings.$inferSelect | undefined;

function productInput(categoryId: string, overrides: Partial<SupplyProductInput> = {}): SupplyProductInput {
  const suffix = randomUUID();
  return {
    categoryId, title: "Synthetic Supplies product", slug: `synthetic-${suffix}`, sku: `SYNTHETIC-${suffix}`,
    shortDescription: "Synthetic description", description: "Synthetic fixture, never a customer product.",
    status: "draft", priceCents: 2300, salePriceCents: null, trackInventory: true, stockQuantity: 5,
    available: true, pickupAllowed: true, shippingAllowed: false, weightGrams: 500,
    packedLengthMm: 300, packedWidthMm: 200, packedHeightMm: 50, seoTitle: "Synthetic SEO",
    seoDescription: "Synthetic metadata", sortOrder: 0, featured: false, variants: [], ...overrides,
  };
}

describe.skipIf(!databaseUrl)("Supplies administration on a session-owned canonical release database", () => {
  beforeAll(async () => {
    const name = decodeURIComponent(new URL(databaseUrl!).pathname.slice(1));
    if (!/^rnr_gallery_test_release_gate_[a-f0-9]{8}_[a-z0-9_]{6,12}_integration$/.test(name)) {
      throw new Error("Supplies writes require a session-specific release-gate disposable database.");
    }
    const readiness = await pool!.query<{ ready: boolean }>("select to_regclass('supplies_audit_logs') is not null and to_regclass('supplies_images') is not null and to_regclass('supplies_stock_reservations') is not null as ready");
    expect(readiness.rows[0]?.ready, "Canonical Supplies migration must run before integration acceptance").toBe(true);
    [priorSettings] = await database!.select().from(suppliesSettings).where(eq(suppliesSettings.key, "primary"));
    await database!.insert(user).values({ id: actor.userId, name: "Synthetic Supplies Administrator", email: `${actor.userId}@example.test`, role: "admin" });
    initialized = true;
  });
  afterAll(async () => {
    try {
      if (initialized) {
        if (imageIds.length) await database!.delete(suppliesImages).where(inArray(suppliesImages.id, imageIds));
        if (productIds.length) {
          await database!.delete(suppliesVariants).where(inArray(suppliesVariants.productId, productIds));
          await database!.delete(suppliesProducts).where(inArray(suppliesProducts.id, productIds));
        }
        if (categoryIds.length) await database!.delete(suppliesCategories).where(inArray(suppliesCategories.id, categoryIds));
        await database!.delete(suppliesAuditLogs).where(eq(suppliesAuditLogs.actorUserId, actor.userId));
        if (priorSettings) await database!.update(suppliesSettings).set({ enabled: priorSettings.enabled, updatedAt: priorSettings.updatedAt, updatedBy: priorSettings.updatedBy }).where(eq(suppliesSettings.key, "primary"));
        else await database!.delete(suppliesSettings).where(eq(suppliesSettings.key, "primary"));
        await database!.delete(user).where(eq(user.id, actor.userId));
      }
    } finally { await pool?.end(); }
  });

  async function category() {
    const id = await createSuppliesAdminService(database!).saveCategory(actor, { name: "Synthetic category", slug: `synthetic-${randomUUID()}`, description: "Synthetic fixture", sortOrder: 900, visible: true, archived: false });
    categoryIds.push(id);
    return id;
  }
  async function product(input: SupplyProductInput) {
    const id = await createSuppliesAdminService(database!).saveProduct(actor, input);
    productIds.push(id);
    return id;
  }

  it("canonical initialization defaults OFF and stores the three initial categories in the database", async () => {
    expect(priorSettings?.enabled).toBe(false);
    const catalogue = await loadSuppliesCatalogue(database!);
    expect(catalogue.categories.map((item) => item.name)).toEqual(expect.arrayContaining([
      "Blank Canvas & Canvas Rolls", "Roll-Up Banner Stands Only", "Canvas Stretcher Bars & Frames",
    ]));
    expect(publicSuppliesCatalogue(catalogue)).toBeNull();
  });

  it("creates, edits, sorts, hides and archives an arbitrary category with transactional audit records", async () => {
    const service = createSuppliesAdminService(database!);
    const id = await category();
    await service.saveCategory(actor, { name: "Synthetic future PVC", slug: `synthetic-pvc-${id}`, description: "Future material", sortOrder: 2, visible: false, archived: false }, id);
    const [edited] = await database!.select().from(suppliesCategories).where(eq(suppliesCategories.id, id));
    expect(edited).toMatchObject({ name: "Synthetic future PVC", slug: `synthetic-pvc-${id}`, sortOrder: 2, visible: false, archived: false });
    await service.archiveCategory(actor, id);
    const [archived] = await database!.select().from(suppliesCategories).where(eq(suppliesCategories.id, id));
    expect(archived).toMatchObject({ visible: false, archived: true });
    const audits = await database!.select().from(suppliesAuditLogs).where(and(eq(suppliesAuditLogs.actorUserId, actor.userId), eq(suppliesAuditLogs.resourceId, id)));
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining(["category.create", "category.update", "category.archive"]));
  });

  it("publishes only eligible products, preserves draft access for admin data and audits each OFF/ON toggle", async () => {
    const service = createSuppliesAdminService(database!);
    const categoryId = await category();
    const draftId = await product(productInput(categoryId));
    const publishedInput = productInput(categoryId, { status: "published" });
    const publishedId = await product(publishedInput);
    await service.saveSettings(actor, { enabled: true });
    const publicCatalogue = publicSuppliesCatalogue(await loadSuppliesCatalogue(database!));
    expect(publicCatalogue?.products.map((item) => item.id)).toContain(publishedId);
    expect(publicCatalogue?.products.map((item) => item.id)).not.toContain(draftId);
    await service.saveProduct(actor, { ...publishedInput, status: "draft", expectedStockQuantity: 5 }, publishedId);
    expect(publicSuppliesCatalogue(await loadSuppliesCatalogue(database!))?.products.map((item) => item.id)).not.toContain(publishedId);
    await service.saveProduct(actor, { ...publishedInput, expectedStockQuantity: 5 }, publishedId);
    await service.archiveProduct(actor, publishedId);
    expect(publicSuppliesCatalogue(await loadSuppliesCatalogue(database!))?.products.map((item) => item.id)).not.toContain(publishedId);
    await service.saveSettings(actor, { enabled: false });
    const administrativeCatalogue = await loadSuppliesCatalogue(database!);
    expect(administrativeCatalogue.products.map((item) => item.id)).toContain(draftId);
    expect(publicSuppliesCatalogue(administrativeCatalogue)).toBeNull();
    await expect(getSupplyPurchaseService(database!).resolve(draftId)).rejects.toThrow("unavailable");
    const audits = await database!.select().from(suppliesAuditLogs).where(and(eq(suppliesAuditLogs.actorUserId, actor.userId), eq(suppliesAuditLogs.action, "store.visibility")));
    expect(audits.slice(-2).map((audit) => audit.afterSummary?.enabled)).toEqual([true, false]);
  });

  it("serializes concurrent cross-table SKU creation so only one product or variant can claim the same SKU", async () => {
    const categoryId = await category();
    const sku = `RACE-${randomUUID()}`;
    const first = productInput(categoryId, { sku });
    const second = productInput(categoryId, { variants: [{ sku: sku.toLowerCase(), label: "Synthetic size", options: { Size: "Large" }, priceCents: 3450, salePriceCents: null, active: true, sortOrder: 0, trackInventory: true, stockQuantity: 3, available: true, weightGrams: null, packedLengthMm: null, packedWidthMm: null, packedHeightMm: null }] });
    const results = await Promise.allSettled([product(first), product(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const matchingProducts = (await database!.select().from(suppliesProducts)).filter((item) => item.sku.toLowerCase() === sku.toLowerCase());
    const matchingVariants = (await database!.select().from(suppliesVariants)).filter((item) => item.sku.toLowerCase() === sku.toLowerCase());
    expect(matchingProducts.length + matchingVariants.length).toBe(1);
  });

  it("persists variant identity, price and independent stock, rejects stale edits, and archives removed variants", async () => {
    const service = createSuppliesAdminService(database!);
    const categoryId = await category();
    const input = productInput(categoryId, { status: "published", variants: [{ sku: `VARIANT-${randomUUID()}`, label: "Synthetic 1 metre", options: { Length: "1 m" }, priceCents: 3450, salePriceCents: 2300, active: true, sortOrder: 0, trackInventory: true, stockQuantity: 2, available: true, weightGrams: 250, packedLengthMm: 1000, packedWidthMm: 30, packedHeightMm: 30 }] });
    const id = await product(input);
    const [original] = await database!.select().from(suppliesVariants).where(eq(suppliesVariants.productId, id));
    await service.saveSettings(actor, { enabled: true });
    const purchasable = await getSupplyPurchaseService(database!).resolve(id, original.id);
    expect(purchasable).toMatchObject({ sku: original.sku, unitPriceCents: 2300, stockQuantity: 2, weightGrams: 250, packedLengthMm: 1000 });
    await database!.update(suppliesVariants).set({ stockQuantity: 1 }).where(eq(suppliesVariants.id, original.id));
    await expect(service.saveProduct(actor, { ...input, expectedStockQuantity: 5, variants: [{ ...input.variants[0], id: original.id, expectedStockQuantity: 2 }] }, id)).rejects.toMatchObject({ status: 409 });
    const [unchanged] = await database!.select().from(suppliesVariants).where(eq(suppliesVariants.id, original.id));
    expect(unchanged.stockQuantity).toBe(1);
    await service.saveProduct(actor, { ...input, expectedStockQuantity: 5, variants: [{ ...input.variants[0], id: original.id, expectedStockQuantity: 1, stockQuantity: 4 }] }, id);
    const [saved] = await database!.select().from(suppliesVariants).where(eq(suppliesVariants.id, original.id));
    expect(saved).toMatchObject({ id: original.id, stockQuantity: 4, archived: false });
    await service.saveProduct(actor, { ...input, expectedStockQuantity: 5, variants: [] }, id);
    const [removed] = await database!.select().from(suppliesVariants).where(eq(suppliesVariants.id, original.id));
    expect(removed).toMatchObject({ archived: true, active: false, available: false });
    expect((await loadSuppliesCatalogue(database!)).products.find((item) => item.id === id)?.variants).toHaveLength(0);
    await service.saveSettings(actor, { enabled: false });
  });

  it("rejects stale base-stock edits instead of overwriting a concurrent stock change", async () => {
    const input = productInput(await category());
    const id = await product(input);
    await database!.update(suppliesProducts).set({ stockQuantity: 3 }).where(eq(suppliesProducts.id, id));
    await expect(createSuppliesAdminService(database!).saveProduct(actor, { ...input, title: "Synthetic stale edit", expectedStockQuantity: 5 }, id)).rejects.toMatchObject({ status: 409 });
    const [remaining] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, id));
    expect(remaining).toMatchObject({ title: input.title, stockQuantity: 3 });
  });

  it("reorders metadata, replaces the cover, edits alt text and detaches only the selected owned image", async () => {
    const service = createSuppliesAdminService(database!);
    const categoryId = await category();
    const ownerId = await product(productInput(categoryId));
    const otherId = await product(productInput(categoryId));
    const firstId = randomUUID();
    const secondId = randomUUID();
    const foreignId = randomUUID();
    for (const [id, productId, isCover, sortOrder] of [[firstId, ownerId, true, 0], [secondId, ownerId, false, 1], [foreignId, otherId, true, 0]] as const) {
      await database!.insert(suppliesImages).values({ id, productId, storageKey: `supplies/${productId}/${id}.webp`, altText: "Synthetic image metadata", width: 800, height: 600, byteLength: 1234, contentHash: "0".repeat(64), isCover, sortOrder });
      imageIds.push(id);
    }
    await service.reorderImages(actor, ownerId, { images: [{ id: secondId, altText: "Synthetic new main image", sortOrder: 0, isCover: true }, { id: firstId, altText: "Synthetic additional image", sortOrder: 1, isCover: false }] });
    const reordered = await database!.select().from(suppliesImages).where(eq(suppliesImages.productId, ownerId));
    expect(reordered.find((image) => image.id === secondId)).toMatchObject({ isCover: true, sortOrder: 0, altText: "Synthetic new main image" });
    await expect(service.reorderImages(actor, ownerId, { images: [{ id: firstId, altText: "Synthetic missing image", sortOrder: 0, isCover: true }] })).rejects.toThrow("all current product images");
    await expect(service.detachImage({ ...actor, canDeleteMedia: false }, { productId: ownerId }, secondId)).rejects.toMatchObject({ status: 403 });
    await expect(service.detachImage(actor, { productId: ownerId }, foreignId)).rejects.toMatchObject({ status: 404 });
    await service.detachImage(actor, { productId: ownerId }, secondId);
    const [detached] = await database!.select().from(suppliesImages).where(eq(suppliesImages.id, secondId));
    const [nextCover] = await database!.select().from(suppliesImages).where(eq(suppliesImages.id, firstId));
    const [foreign] = await database!.select().from(suppliesImages).where(eq(suppliesImages.id, foreignId));
    expect(detached).toMatchObject({ productId: null, categoryId: null, isCover: false, storageKey: `supplies/${ownerId}/${secondId}.webp` });
    expect(detached.detachedAt).toBeInstanceOf(Date);
    expect(nextCover.isCover).toBe(true);
    expect(foreign).toMatchObject({ productId: otherId, isCover: true, detachedAt: null });
    expect((await loadSuppliesCatalogue(database!)).products.find((item) => item.id === ownerId)?.images.map((image) => image.id)).toEqual([firstId]);
  });
});
