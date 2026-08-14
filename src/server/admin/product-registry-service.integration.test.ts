import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  productRegistryCurrent,
  productRegistryRevisions,
  user,
} from "@/server/db/schema";
import {
  createDrizzleProductRegistryRepository,
  createProductRegistryService,
} from "./product-registry-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const actorId = `registry-actor-${suffix}`;
const actorEmail = `registry-actor-${suffix}@example.test`;
let previous: typeof productRegistryCurrent.$inferSelect | null = null;

describe("product registry persistence", () => {
  beforeAll(async () => {
    const [current] = await database.select().from(productRegistryCurrent).limit(1);
    previous = current ?? null;
    await database.insert(user).values({
      id: actorId,
      name: "Registry Actor",
      email: actorEmail,
      role: "admin",
    });
  });

  afterAll(async () => {
    if (previous) {
      await database.insert(productRegistryCurrent).values(previous).onConflictDoUpdate({
        target: productRegistryCurrent.registryKey,
        set: {
          revision: previous.revision,
          snapshot: previous.snapshot,
          publishedBy: previous.publishedBy,
          publishedAt: previous.publishedAt,
        },
      });
    } else {
      await database.delete(productRegistryCurrent).where(
        eq(productRegistryCurrent.registryKey, "primary"),
      );
    }
    await database.delete(productRegistryRevisions).where(
      eq(productRegistryRevisions.publishedBy, actorId),
    );
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("publishes one revision and one audit record for an idempotent request", async () => {
    const service = createProductRegistryService(
      createDrizzleProductRegistryRepository(database),
    );
    const current = await service.current();
    const rollUp = current.registry.products.find(
      (product) => product.key === "roll-up-banner",
    )!;
    const input = {
      productKey: rollUp.key,
      expectedRevision: current.revision,
      idempotencyKey: `registry-publish-${suffix}`,
      requestSource: "integration-test",
      title: rollUp.title,
      summary: rollUp.summary,
      imageSrc: rollUp.image.src,
      imageAlt: rollUp.image.alt,
      active: rollUp.active,
      featured: rollUp.featured,
      sizes: rollUp.configuration.sizes.map((size, index) => ({
        ...size,
        priceExGstCents: size.priceExGstCents + (index === 0 ? 100 : 0),
      })),
      includedPhotos: rollUp.configuration.includedPhotos,
      extraPhotoPriceExGstCents:
        rollUp.configuration.extraPhotoPriceExGstCents ?? null,
      extraBackgroundRemovalFeeInclGstCents:
        rollUp.configuration.extraBackgroundRemovalFeeInclGstCents ?? null,
    };

    await expect(service.publishProduct(
      { userId: actorId, email: actorEmail },
      input,
    )).resolves.toMatchObject({ result: "published", revision: current.revision + 1 });
    await expect(service.publishProduct(
      { userId: actorId, email: actorEmail },
      input,
    )).resolves.toMatchObject({ result: "duplicate", revision: current.revision + 1 });

    const revisions = await database.select({ revision: productRegistryRevisions.revision })
      .from(productRegistryRevisions)
      .where(eq(productRegistryRevisions.publishedBy, actorId));
    const audit = await database.select({ action: adminAuditLogs.action })
      .from(adminAuditLogs)
      .where(and(
        eq(adminAuditLogs.actorUserId, actorId),
        eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
      ));
    expect(revisions).toEqual([{ revision: current.revision + 1 }]);
    expect(audit).toEqual([{ action: "product.registry.product.published" }]);
  });
});
