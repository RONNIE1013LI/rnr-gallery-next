import type {
  AdminCustomerReview,
  AdminCustomerReviewFilter,
  AdminFacebookReviewSettings,
  CustomerReviewMutationInput,
  CustomerReviewStatus,
  FacebookReviewSummaryInput,
  PublicCustomerReview,
} from "@/domain/customer-reviews/types";

export type ReviewActor = Readonly<{
  userId: string;
  email: string;
  idempotencyKey: string;
  requestSource?: string;
}>;

export type PersistedCustomerReviewInput = CustomerReviewMutationInput & Readonly<{
  status: CustomerReviewStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
}>;

export type CustomerReviewRepository = Readonly<{
  listAdmin(filter?: AdminCustomerReviewFilter): Promise<readonly AdminCustomerReview[]>;
  findAdmin(id: string): Promise<AdminCustomerReview | null>;
  create(input: PersistedCustomerReviewInput, actor: ReviewActor): Promise<AdminCustomerReview>;
  update(id: string, input: PersistedCustomerReviewInput, actor: ReviewActor): Promise<AdminCustomerReview | null>;
  archive(id: string, actor: ReviewActor, archivedAt: Date): Promise<AdminCustomerReview | null>;
  listPublic(input?: {
    productKey?: string;
    limit?: number;
  }): Promise<readonly PublicCustomerReview[]>;
  getSettings(): Promise<AdminFacebookReviewSettings>;
  saveSettings(
    input: FacebookReviewSummaryInput,
    actor: ReviewActor,
    publish: boolean,
  ): Promise<AdminFacebookReviewSettings>;
}>;
