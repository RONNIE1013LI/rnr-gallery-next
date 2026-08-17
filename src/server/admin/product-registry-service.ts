import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  defaultProductRegistry,
  parseProductRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import {
  australiaPriceBookSchema,
  synchronizeNewZealandPriceBook,
} from "@/domain/catalogue/market-price-book";
import { BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT } from "@/domain/bundles/banner-bundle";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  productRegistryCurrent,
  productRegistryRevisions,
  user,
} from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";

const REGISTRY_KEY = "primary";
const cents = z.number().int().min(0).max(100_000_000);
const mutationBase = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(255),
  requestSource: z.string().trim().min(1).max(255).optional(),
});
const productPatchSchema = mutationBase.extend({
  productKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(190),
  summary: z.string().trim().min(1).max(800),
  imageSrc: z.string().trim().regex(/^\/media\//).max(500),
  imageAlt: z.string().trim().min(10).max(500),
  active: z.boolean(),
  featured: z.boolean(),
  sizes: z.array(z.object({
    key: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    priceExGstCents: cents,
    nzAmountInclTaxCents: cents.optional(),
  }).strict()).min(1),
  includedPhotos: z.number().int().min(0).max(20),
  extraPhotoPriceExGstCents: cents.nullable(),
  extraBackgroundRemovalFeeInclGstCents: cents.nullable(),
}).strict().superRefine((input, context) => {
  if (input.productKey !== "banner-bundle") return;
  if (
    input.includedPhotos !== BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT
  ) {
    context.addIssue({
      code: "custom",
      path: ["includedPhotos"],
      message: `Banner Bundle requires exactly ${BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT} included photos per component.`,
    });
  }
  for (const [index, size] of input.sizes.entries()) {
    if (size.nzAmountInclTaxCents === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sizes", index, "nzAmountInclTaxCents"],
        message: "Every Banner Bundle size requires an exact NZ GST-inclusive price.",
      });
    }
  }
});
const pricingPatchSchema = mutationBase.extend({
  peoplePetsFeesExGstCents: z.array(cents).length(5),
  additionalPeoplePetsEachExGstCents: cents,
  urgentServiceFeesInclGstCents: z.array(cents).length(4),
}).strict();
const marketPatchSchema = mutationBase.extend({
  priceBook: australiaPriceBookSchema,
}).strict();

type Database = ReturnType<typeof getDatabase>;
type Actor = Readonly<{ userId: string; email: string }>;
type RegistryState = Readonly<{ revision: number; snapshot: unknown }>;
type Publication = Readonly<{
  actor: Actor;
  expectedRevision: number;
  idempotencyKey: string;
  requestSource?: string;
  action: string;
  resourceId: string;
  beforeSummary: Readonly<Record<string, unknown>>;
  afterSummary: Readonly<Record<string, unknown>>;
  snapshot: ProductRegistryDocument;
}>;
type PublicationResult =
  | Readonly<{ result: "published" | "duplicate"; revision: number; snapshot: unknown }>
  | Readonly<{ result: "conflict" }>;
export type ProductRegistryRepository = Readonly<{
  read: () => Promise<RegistryState | null>;
  publish: (input: Publication) => Promise<PublicationResult>;
}>;

export class ProductRegistryValidationError extends Error {}
export class ProductRegistryConflictError extends Error {}
export class ProductRegistryAuthorizationError extends Error {}

function currentRegistry(state: RegistryState | null) {
  return Object.freeze({
    revision: state?.revision ?? 0,
    registry: state ? parseProductRegistry(state.snapshot) : parseProductRegistry(defaultProductRegistry),
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

export function createProductRegistryService(
  repository: ProductRegistryRepository,
  dependencies: Readonly<{
    assetExists?: (imageSrc: string) => Promise<boolean>;
  }> = {},
) {
  async function load() {
    return currentRegistry(await repository.read());
  }

  async function publish(
    actor: Actor,
    expectedRevision: number,
    publication: Omit<Publication, "actor" | "expectedRevision">,
  ) {
    const result = await repository.publish({
      actor,
      expectedRevision,
      ...publication,
    });
    if (result.result === "conflict") {
      throw new ProductRegistryConflictError(
        "Product pricing has changed. Refresh the page before publishing again.",
      );
    }
    return Object.freeze({
      result: result.result,
      revision: result.revision,
      registry: parseProductRegistry(result.snapshot),
    });
  }

  return Object.freeze({
    current: load,

    async publishProduct(actor: Actor, input: unknown) {
      const parsed = productPatchSchema.safeParse(input);
      if (!parsed.success) {
        throw new ProductRegistryValidationError("Enter valid product and price values.");
      }
      if (dependencies.assetExists && !await dependencies.assetExists(parsed.data.imageSrc)) {
        throw new ProductRegistryValidationError("Product image was not found in Media.");
      }
      const current = await load();
      const next = structuredClone(current.registry);
      const product = next.products.find(
        (candidate) => candidate.key === parsed.data.productKey,
      );
      if (!product) throw new ProductRegistryValidationError("The product is unavailable.");
      const beforeSummary = {
        title: product.title,
        active: product.active,
        featured: product.featured,
        sizePrices: Object.fromEntries(
          product.configuration.sizes.map((size) => [size.key, size.priceExGstCents]),
        ),
      };
      product.title = parsed.data.title;
      product.summary = parsed.data.summary;
      product.image = { src: parsed.data.imageSrc, alt: parsed.data.imageAlt };
      product.active = parsed.data.active;
      product.featured = parsed.data.featured;
      product.configuration.sizes = parsed.data.sizes.map((size) => {
        const { nzAmountInclTaxCents, ...legacySize } = size;
        return nzAmountInclTaxCents === undefined
          ? legacySize
          : { ...legacySize, nzAmountInclTaxCents };
      });
      product.configuration.includedPhotos = parsed.data.includedPhotos;
      if (parsed.data.extraPhotoPriceExGstCents === null) {
        delete product.configuration.extraPhotoPriceExGstCents;
      } else {
        product.configuration.extraPhotoPriceExGstCents = parsed.data.extraPhotoPriceExGstCents;
      }
      if (parsed.data.extraBackgroundRemovalFeeInclGstCents === null) {
        delete product.configuration.extraBackgroundRemovalFeeInclGstCents;
      } else {
        product.configuration.extraBackgroundRemovalFeeInclGstCents =
          parsed.data.extraBackgroundRemovalFeeInclGstCents;
      }
      synchronizeNewZealandPriceBook(next);
      let registry: ProductRegistryDocument;
      try {
        registry = parseProductRegistry(next);
      } catch (error) {
        throw new ProductRegistryValidationError(
          error instanceof Error ? error.message : "The product registry is invalid.",
        );
      }
      return publish(actor, parsed.data.expectedRevision, {
        idempotencyKey: parsed.data.idempotencyKey,
        ...withoutUndefined({ requestSource: parsed.data.requestSource }),
        action: "product.registry.product.published",
        resourceId: parsed.data.productKey,
        beforeSummary,
        afterSummary: {
          title: product.title,
          active: product.active,
          featured: product.featured,
          sizePrices: Object.fromEntries(
            product.configuration.sizes.map((size) => [size.key, size.priceExGstCents]),
          ),
        },
        snapshot: registry,
      });
    },

    async publishPricing(actor: Actor, input: unknown) {
      const parsed = pricingPatchSchema.safeParse(input);
      if (!parsed.success) {
        throw new ProductRegistryValidationError("Enter valid store-wide fee values.");
      }
      const current = await load();
      const next = structuredClone(current.registry);
      const beforeSummary = { ...next.pricing };
      next.pricing = {
        peoplePetsFeesExGstCents: [...parsed.data.peoplePetsFeesExGstCents],
        additionalPeoplePetsEachExGstCents:
          parsed.data.additionalPeoplePetsEachExGstCents,
        urgentServiceFeesInclGstCents: [...parsed.data.urgentServiceFeesInclGstCents],
      };
      synchronizeNewZealandPriceBook(next);
      let registry: ProductRegistryDocument;
      try {
        registry = parseProductRegistry(next);
      } catch (error) {
        throw new ProductRegistryValidationError(
          error instanceof Error ? error.message : "The pricing policy is invalid.",
        );
      }
      return publish(actor, parsed.data.expectedRevision, {
        idempotencyKey: parsed.data.idempotencyKey,
        ...withoutUndefined({ requestSource: parsed.data.requestSource }),
        action: "product.registry.pricing.published",
        resourceId: "pricing",
        beforeSummary,
        afterSummary: { ...registry.pricing },
        snapshot: registry,
      });
    },

    async publishMarket(actor: Actor, input: unknown) {
      const parsed = marketPatchSchema.safeParse(input);
      if (!parsed.success) {
        throw new ProductRegistryValidationError("Enter valid Australia price-book values.");
      }
      const current = await load();
      const next = structuredClone(current.registry);
      const beforeSummary = {
        enabled: next.markets.AU.enabled,
        tax: { ...next.markets.AU.tax },
      };
      next.markets.AU = structuredClone(parsed.data.priceBook);
      let registry: ProductRegistryDocument;
      try {
        registry = parseProductRegistry(next);
      } catch (error) {
        throw new ProductRegistryValidationError(
          error instanceof Error ? error.message : "The Australia price book is invalid.",
        );
      }
      return publish(actor, parsed.data.expectedRevision, {
        idempotencyKey: parsed.data.idempotencyKey,
        ...withoutUndefined({ requestSource: parsed.data.requestSource }),
        action: "product.registry.market.published",
        resourceId: "AU",
        beforeSummary,
        afterSummary: {
          enabled: registry.markets.AU.enabled,
          tax: { ...registry.markets.AU.tax },
        },
        snapshot: registry,
      });
    },
  });
}

export function createDrizzleProductRegistryRepository(
  database: Database,
): ProductRegistryRepository {
  return Object.freeze({
    async read() {
      const [row] = await database
        .select({ revision: productRegistryCurrent.revision, snapshot: productRegistryCurrent.snapshot })
        .from(productRegistryCurrent)
        .where(eq(productRegistryCurrent.registryKey, REGISTRY_KEY))
        .limit(1);
      return row ?? null;
    },

    async publish(input) {
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext('rnr_product_registry_publish'))`,
        );
        const [currentActor] = await transaction
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, input.actor.userId))
          .limit(1);
        if (currentActor?.role !== "admin") {
          throw new ProductRegistryAuthorizationError(
            "Administrator access has changed. Sign in again.",
          );
        }
        const [duplicate] = await transaction
          .select({ resourceId: adminAuditLogs.resourceId })
          .from(adminAuditLogs)
          .where(and(
            eq(adminAuditLogs.actorUserId, input.actor.userId),
            eq(adminAuditLogs.action, input.action),
            eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        const [current] = await transaction
          .select({ revision: productRegistryCurrent.revision, snapshot: productRegistryCurrent.snapshot })
          .from(productRegistryCurrent)
          .where(eq(productRegistryCurrent.registryKey, REGISTRY_KEY))
          .limit(1);
        if (duplicate) {
          if (duplicate.resourceId !== input.resourceId || !current) {
            throw new ProductRegistryConflictError(
              "This publication request has already been used.",
            );
          }
          return {
            result: "duplicate" as const,
            revision: current.revision,
            snapshot: current.snapshot,
          };
        }
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          return { result: "conflict" as const };
        }
        const revision = currentRevision + 1;
        const publishedAt = new Date();
        await transaction.insert(productRegistryRevisions).values({
          registryKey: REGISTRY_KEY,
          revision,
          snapshot: input.snapshot,
          publishedBy: input.actor.userId,
          publishedAt,
        });
        await transaction.insert(productRegistryCurrent).values({
          registryKey: REGISTRY_KEY,
          revision,
          snapshot: input.snapshot,
          publishedBy: input.actor.userId,
          publishedAt,
        }).onConflictDoUpdate({
          target: productRegistryCurrent.registryKey,
          set: {
            revision,
            snapshot: input.snapshot,
            publishedBy: input.actor.userId,
            publishedAt,
          },
        });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: input.action,
          resourceType: "product_registry",
          resourceId: input.resourceId,
          beforeSummary: input.beforeSummary,
          afterSummary: { ...input.afterSummary, revision },
          ...(input.requestSource ? { requestSource: input.requestSource } : {}),
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return { result: "published" as const, revision, snapshot: input.snapshot };
      });
    },
  });
}
