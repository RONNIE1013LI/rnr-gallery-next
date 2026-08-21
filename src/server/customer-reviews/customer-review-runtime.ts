import { cache } from "react";
import type { PublicCustomerReviewSection } from "@/domain/customer-reviews/types";
import type { CustomerReviewMediaKind } from "@/domain/customer-reviews/types";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { getDatabase } from "@/server/db/client";
import type { UploadFile } from "@/server/uploads/local-private-upload-store";
import {
  persistReviewWithMedia,
  type ReviewMediaStore,
} from "./customer-review-media";
import type { ReviewActor } from "./customer-review-repository";
import { createCustomerReviewService } from "./customer-review-service";
import {
  createDrizzleCustomerReviewMediaRepository,
  createDrizzleCustomerReviewRepository,
  type CustomerReviewDatabase,
} from "./drizzle-customer-review-repository";

export function getCustomerReviewRuntime(
  database: CustomerReviewDatabase = getDatabase(),
) {
  const productRegistry = getProductRegistryRuntime();
  return createCustomerReviewService({
    repository: createDrizzleCustomerReviewRepository(database),
    async isKnownProductKey(productKey) {
      const state = await productRegistry.current();
      return state.registry.products.some((product) => product.key === productKey);
    },
  });
}

export async function persistCustomerReviewMutationWithMedia<T extends { id: string }>(
  input: Readonly<{
    database?: ReturnType<typeof getDatabase>;
    store: ReviewMediaStore;
    actor: ReviewActor;
    media: readonly Readonly<{ kind: CustomerReviewMediaKind; file: UploadFile }>[];
    mutate(service: ReturnType<typeof getCustomerReviewRuntime>): Promise<T>;
    onCleanupFailure?: (error: unknown) => void;
  }>,
) {
  const database = input.database ?? getDatabase();
  return persistReviewWithMedia({
    media: input.media,
    store: input.store,
    onCleanupFailure: input.onCleanupFailure,
    persist: (prepared) => database.transaction(async (transaction) => {
      const service = getCustomerReviewRuntime(transaction);
      const mediaRepository = createDrizzleCustomerReviewMediaRepository(transaction);
      const value = await input.mutate(service);
      const replaced = [];
      for (const media of prepared) {
        const old = await mediaRepository.replace({
          reviewId: value.id,
          ...media,
          actor: input.actor,
        });
        if (old) replaced.push(old);
      }
      return { value, replaced };
    }),
  });
}

export const getSafePublicCustomerReviewSection = cache(async function getSafePublicCustomerReviewSection(
  service: Readonly<{
    getSafePublicSection(): Promise<PublicCustomerReviewSection | null>;
  }> = getCustomerReviewRuntime(),
): Promise<PublicCustomerReviewSection | null> {
  try {
    return await service.getSafePublicSection();
  } catch {
    return null;
  }
});
