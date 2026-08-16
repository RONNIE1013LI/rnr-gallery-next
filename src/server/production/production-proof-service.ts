import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  OrderFulfilmentStatus,
  ProductionJobFileKind,
  ProductionProofDecision,
  ProductionProofReviewerType,
} from "@/server/db/schema";
import type { PrivateUploadReference } from "@/server/uploads/local-private-upload-store";

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();

const fileSchema = z.object({
  kind: z.enum(["customer_file", "payment_proof", "design_draft", "print_file"]),
  idempotencyKey: z.string().trim().min(8).max(255),
  reference: z.object({
    id: z.string().uuid(),
    originalName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]),
    size: z.number().int().min(1).max(25 * 1024 * 1024),
    storageKey: z.string().regex(/^[0-9a-f-]{36}\.bin$/i),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
}).strict().superRefine((file, context) => {
  if (file.kind !== "payment_proof" && file.reference.mimeType === "application/pdf") {
    context.addIssue({
      code: "custom",
      path: ["reference", "mimeType"],
      message: "PDF is only allowed for payment proof",
    });
  }
});

const reviewSchema = z.object({
  fileId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.string().trim().max(5_000).default(""),
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict();

const orderNumberSchema = z.string().trim().regex(/^RNR-\d{4}-[A-Z0-9]+$/);
const customerAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer"), userId: z.string().trim().min(1).max(255) }).strict(),
  z.object({ kind: z.literal("checkout"), tokenDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ kind: z.literal("signed"), fileId: z.string().uuid() }).strict(),
]);
const customerReviewSchema = reviewSchema.superRefine((review, context) => {
  if (review.decision === "changes_requested" && !review.notes) {
    context.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Please list the requested changes together",
    });
  }
});

export type ProductionActor = Readonly<z.output<typeof actorSchema>>;
export type CustomerProofAccess = Readonly<z.output<typeof customerAccessSchema>>;
export type ProductionFileSummary = Readonly<{
  id: string;
  jobId: string;
  kind: ProductionJobFileKind;
  version: number | null;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: Date;
  review: Readonly<{
    id: string;
    decision: ProductionProofDecision;
    notes: string;
    reviewerType: ProductionProofReviewerType;
    createdAt: Date;
  }> | null;
}>;

export type ProductionPrivateFile = ProductionFileSummary & Readonly<{
  storageKey: string;
}>;

export type CustomerProofFileSummary = Readonly<{
  id: string;
  version: number;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: Date;
  review: ProductionFileSummary["review"];
}>;

export type CustomerProofBundle = Readonly<{
  orderNumber: string;
  fulfilmentStatus: OrderFulfilmentStatus;
  files: readonly CustomerProofFileSummary[];
}>;

export interface ProductionProofRepository {
  findFileByIdempotencyKey(idempotencyKey: string): Promise<
    (ProductionFileSummary & Readonly<{ requestDigest: string }>) | null
  >;
  createFile(input: Readonly<{
    jobId: string;
    kind: ProductionJobFileKind;
    idempotencyKey: string;
    requestDigest: string;
    reference: PrivateUploadReference;
    actor: ProductionActor;
    createdAt: Date;
  }>): Promise<Readonly<{
    result: "created" | "duplicate" | "conflict" | "not_found" | "payment_required";
    file?: ProductionFileSummary;
  }>>;
  recordReview(input: Readonly<{
    jobId: string;
    fileId: string;
    decision: ProductionProofDecision;
    notes: string;
    idempotencyKey: string;
    actor: ProductionActor;
    createdAt: Date;
  }>): Promise<Readonly<{
    result: "created" | "duplicate" | "conflict" | "not_found" | "invalid_file" | "invalid_status" | "payment_required";
    review?: Readonly<{
      id: string;
      fileId: string;
      decision: ProductionProofDecision;
      notes: string;
      createdAt: Date;
    }>;
  }>>;
  listCustomerProofs(
    orderNumber: string,
    access: CustomerProofAccess,
  ): Promise<CustomerProofBundle | null>;
  findCustomerPrivateFile(
    orderNumber: string,
    fileId: string,
    access: CustomerProofAccess,
  ): Promise<ProductionPrivateFile | null>;
  recordCustomerReview(input: Readonly<{
    orderNumber: string;
    access: CustomerProofAccess;
    fileId: string;
    decision: ProductionProofDecision;
    notes: string;
    idempotencyKey: string;
    createdAt: Date;
  }>): Promise<Readonly<{
    result: "created" | "duplicate" | "conflict" | "not_found" | "invalid_file" | "invalid_status" | "payment_required";
    review?: Readonly<{
      id: string;
      fileId: string;
      decision: ProductionProofDecision;
      notes: string;
      reviewerType: "customer";
      createdAt: Date;
    }>;
  }>>;
  listJobFiles(jobId: string, permissions: Readonly<{ canViewFinance: boolean }>): Promise<readonly ProductionFileSummary[]>;
  findPrivateFile(jobId: string, fileId: string): Promise<ProductionPrivateFile | null>;
}

export class ProductionProofValidationError extends Error {
  constructor(message = "Production file data is invalid") {
    super(message);
    this.name = "ProductionProofValidationError";
  }
}
export class ProductionProofForbiddenError extends Error {
  constructor(message = "Finance permission is required") {
    super(message);
    this.name = "ProductionProofForbiddenError";
  }
}
export class ProductionProofConflictError extends Error {
  constructor(message = "This request was already used") {
    super(message);
    this.name = "ProductionProofConflictError";
  }
}
export class ProductionProofNotFoundError extends Error {
  constructor(message = "Production file was not found") {
    super(message);
    this.name = "ProductionProofNotFoundError";
  }
}

function fileDigest(jobId: string, file: z.output<typeof fileSchema>) {
  return createHash("sha256").update(JSON.stringify({
    jobId,
    kind: file.kind,
    reference: {
      originalName: file.reference.originalName,
      mimeType: file.reference.mimeType,
      size: file.reference.size,
      sha256: file.reference.sha256,
    },
  })).digest("hex");
}

export function deriveRevisionSummary(
  reviews: readonly Readonly<{ decision: ProductionProofDecision }>[],
) {
  const changesRequested = reviews.filter((review) => review.decision === "changes_requested").length;
  return Object.freeze({
    changesRequested,
    freeRevisionsRemaining: Math.max(0, 2 - changesRequested),
    requiresAdditionalChargeReview: changesRequested > 2,
  });
}

export function createProductionProofService(
  repository: ProductionProofRepository,
  dependencies: Readonly<{ now?: () => Date }> = {},
) {
  return Object.freeze({
    async registerFile(
      actorInput: unknown,
      jobIdInput: unknown,
      fileInput: unknown,
      permissions: Readonly<{ canManageFinance: boolean }>,
    ) {
      const actor = actorSchema.safeParse(actorInput);
      const jobId = z.string().uuid().safeParse(jobIdInput);
      const file = fileSchema.safeParse(fileInput);
      if (!actor.success || !jobId.success || !file.success) {
        throw new ProductionProofValidationError();
      }
      if (file.data.kind === "payment_proof" && !permissions.canManageFinance) {
        throw new ProductionProofForbiddenError();
      }
      const requestDigest = fileDigest(jobId.data, file.data);
      const existing = await repository.findFileByIdempotencyKey(file.data.idempotencyKey);
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new ProductionProofConflictError();
        return Object.freeze({ result: "duplicate" as const, file: existing });
      }
      const result = await repository.createFile({
        jobId: jobId.data,
        kind: file.data.kind,
        idempotencyKey: file.data.idempotencyKey,
        requestDigest,
        reference: file.data.reference,
        actor: actor.data,
        createdAt: dependencies.now?.() ?? new Date(),
      });
      if (result.result === "not_found") throw new ProductionProofNotFoundError("Production job was not found");
      if (result.result === "payment_required") {
        throw new ProductionProofConflictError("Payment must be confirmed before production can begin");
      }
      if (result.result === "conflict") throw new ProductionProofConflictError();
      if (!result.file) throw new Error("Production file repository returned no file");
      return Object.freeze({ result: result.result, file: result.file });
    },

    async recordReview(actorInput: unknown, jobIdInput: unknown, reviewInput: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const jobId = z.string().uuid().safeParse(jobIdInput);
      const review = reviewSchema.safeParse(reviewInput);
      if (!actor.success || !jobId.success || !review.success) {
        throw new ProductionProofValidationError();
      }
      const result = await repository.recordReview({
        jobId: jobId.data,
        ...review.data,
        actor: actor.data,
        createdAt: dependencies.now?.() ?? new Date(),
      });
      if (result.result === "not_found") throw new ProductionProofNotFoundError();
      if (result.result === "invalid_file") throw new ProductionProofValidationError("Only a design draft can be reviewed");
      if (result.result === "invalid_status") {
        throw new ProductionProofConflictError("This job is not awaiting a proof decision");
      }
      if (result.result === "payment_required") {
        throw new ProductionProofConflictError("Payment must be confirmed before production can begin");
      }
      if (result.result === "conflict") throw new ProductionProofConflictError("This design draft already has a decision");
      if (!result.review) throw new Error("Production review repository returned no review");
      return Object.freeze({ result: result.result, review: result.review });
    },

    async listCustomerProofs(
      orderNumberInput: unknown,
      accessInput: unknown,
    ) {
      const orderNumber = orderNumberSchema.safeParse(orderNumberInput);
      const access = customerAccessSchema.safeParse(accessInput);
      if (!orderNumber.success || !access.success) {
        throw new ProductionProofNotFoundError();
      }
      const result = await repository.listCustomerProofs(orderNumber.data, access.data);
      if (!result) throw new ProductionProofNotFoundError();
      return Object.freeze({
        ...result,
        files: Object.freeze(result.files),
        revision: deriveRevisionSummary(
          result.files.flatMap((file) => file.review ? [file.review] : []),
        ),
      });
    },

    async getCustomerPrivateFile(
      orderNumberInput: unknown,
      fileIdInput: unknown,
      accessInput: unknown,
    ) {
      const orderNumber = orderNumberSchema.safeParse(orderNumberInput);
      const fileId = z.string().uuid().safeParse(fileIdInput);
      const access = customerAccessSchema.safeParse(accessInput);
      if (!orderNumber.success || !fileId.success || !access.success) {
        throw new ProductionProofNotFoundError();
      }
      const file = await repository.findCustomerPrivateFile(
        orderNumber.data,
        fileId.data,
        access.data,
      );
      if (!file || file.kind !== "design_draft") throw new ProductionProofNotFoundError();
      return file;
    },

    async recordCustomerReview(
      orderNumberInput: unknown,
      accessInput: unknown,
      reviewInput: unknown,
    ) {
      const orderNumber = orderNumberSchema.safeParse(orderNumberInput);
      const access = customerAccessSchema.safeParse(accessInput);
      const review = customerReviewSchema.safeParse(reviewInput);
      if (!orderNumber.success || !access.success || !review.success) {
        throw new ProductionProofValidationError(
          review.success ? "Customer proof data is invalid" :
            review.error.issues[0]?.message ?? "Customer proof data is invalid",
        );
      }
      const result = await repository.recordCustomerReview({
        orderNumber: orderNumber.data,
        access: access.data,
        ...review.data,
        notes: review.data.decision === "approved" ? "" : review.data.notes,
        createdAt: dependencies.now?.() ?? new Date(),
      });
      if (result.result === "not_found") throw new ProductionProofNotFoundError();
      if (result.result === "invalid_file") {
        throw new ProductionProofValidationError("Only the latest design draft can be reviewed");
      }
      if (result.result === "invalid_status") {
        throw new ProductionProofConflictError("This order is not awaiting a proof decision");
      }
      if (result.result === "payment_required") {
        throw new ProductionProofConflictError("Payment must be confirmed before production can begin");
      }
      if (result.result === "conflict") {
        throw new ProductionProofConflictError("This design draft already has a decision");
      }
      if (!result.review) throw new Error("Production review repository returned no review");
      return Object.freeze({ result: result.result, review: result.review });
    },

    async listFiles(jobIdInput: unknown, permissions: Readonly<{ canViewFinance: boolean }>) {
      const jobId = z.string().uuid().safeParse(jobIdInput);
      if (!jobId.success) throw new ProductionProofValidationError();
      const files = await repository.listJobFiles(jobId.data, permissions);
      return Object.freeze({
        files: Object.freeze(files),
        revision: deriveRevisionSummary(files.flatMap((file) => file.review ? [file.review] : [])),
      });
    },

    async getPrivateFile(jobIdInput: unknown, fileIdInput: unknown, permissions: Readonly<{ canViewFinance: boolean }>) {
      const jobId = z.string().uuid().safeParse(jobIdInput);
      const fileId = z.string().uuid().safeParse(fileIdInput);
      if (!jobId.success || !fileId.success) throw new ProductionProofNotFoundError();
      const file = await repository.findPrivateFile(jobId.data, fileId.data);
      if (!file) throw new ProductionProofNotFoundError();
      if (file.kind === "payment_proof" && !permissions.canViewFinance) {
        throw new ProductionProofForbiddenError();
      }
      return file;
    },
  });
}
