import type {
  AdminCustomerReviewFilter,
  FacebookReviewSummaryInput,
  PublicCustomerReviewSection,
} from "@/domain/customer-reviews/types";
import {
  parseCustomerReviewMutation,
  parseFacebookReviewSummary,
} from "@/domain/customer-reviews/validation";
import type {
  CustomerReviewRepository,
  PersistedCustomerReviewInput,
  ReviewActor,
} from "./customer-review-repository";

export class CustomerReviewPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerReviewPolicyError";
  }
}

type ServiceDependencies = Readonly<{
  repository: CustomerReviewRepository;
  isKnownProductKey: (productKey: string) => boolean | Promise<boolean>;
  now?: () => Date;
}>;

function assertPublishable(input: ReturnType<typeof parseCustomerReviewMutation>) {
  if (input.permissionStatus !== "GRANTED") {
    throw new CustomerReviewPolicyError("Permission must be granted before publishing");
  }
  if (input.recommendationStatus !== "RECOMMENDS") {
    throw new CustomerReviewPolicyError("Only Facebook recommendations can be published");
  }
}

function persistedInput(
  input: ReturnType<typeof parseCustomerReviewMutation>,
  publish: boolean,
  now: Date,
): PersistedCustomerReviewInput {
  return Object.freeze({
    ...input,
    isHomepageFeatured: publish ? input.isHomepageFeatured : false,
    status: publish ? "PUBLISHED" : "DRAFT",
    publishedAt: publish ? now : null,
    archivedAt: null,
  });
}

export function createCustomerReviewService(dependencies: ServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function validateProduct(input: ReturnType<typeof parseCustomerReviewMutation>) {
    if (input.productKey && !await dependencies.isKnownProductKey(input.productKey)) {
      throw new CustomerReviewPolicyError("Choose a valid associated product");
    }
  }

  async function validateMutation(input: unknown, options: { publish: boolean }) {
    const parsed = parseCustomerReviewMutation(input);
    await validateProduct(parsed);
    if (options.publish) assertPublishable(parsed);
    return parsed;
  }

  return Object.freeze({
    listAdmin: (filter?: AdminCustomerReviewFilter) => dependencies.repository.listAdmin(filter),
    getAdmin: (id: string) => dependencies.repository.findAdmin(id),

    validateMutation,

    async create(input: unknown, actor: ReviewActor, options: { publish: boolean }) {
      const parsed = await validateMutation(input, options);
      return dependencies.repository.create(
        persistedInput(parsed, options.publish, now()),
        actor,
      );
    },

    async update(
      id: string,
      input: unknown,
      actor: ReviewActor,
      options: { publish: boolean },
    ) {
      const parsed = await validateMutation(input, options);
      return dependencies.repository.update(
        id,
        persistedInput(parsed, options.publish, now()),
        actor,
      );
    },

    archive: (id: string, actor: ReviewActor) =>
      dependencies.repository.archive(id, actor, now()),

    getSettings: () => dependencies.repository.getSettings(),

    saveSettings(
      input: unknown,
      actor: ReviewActor,
      options: { publish: boolean },
    ) {
      const parsed: FacebookReviewSummaryInput = parseFacebookReviewSummary(input);
      return dependencies.repository.saveSettings(parsed, actor, options.publish);
    },

    async getSafePublicSection(input: { productKey?: string; limit?: number } = {})
      : Promise<PublicCustomerReviewSection | null> {
      const reviews = await dependencies.repository.listPublic(input);
      if (reviews.length === 0) return null;

      const featured = reviews.find((review) => review.isHomepageFeatured) ?? reviews[0];
      const settings = await dependencies.repository.getSettings();
      const summary = settings.published ? Object.freeze({
        rating: settings.published.facebookRating,
        recommendationCount: settings.published.facebookRecommendationCount,
        countIsApproximate: settings.published.facebookCountIsApproximate,
        reviewsPageUrl: settings.published.facebookReviewsPageUrl,
        lastVerifiedAt: settings.published.facebookLastVerifiedAt,
      }) : null;

      return Object.freeze({
        summary,
        featured,
        reviews: Object.freeze(reviews.filter((review) => review.id !== featured.id)),
      });
    },
  });
}

export type CustomerReviewService = ReturnType<typeof createCustomerReviewService>;
