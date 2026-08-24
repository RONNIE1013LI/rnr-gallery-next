import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  INTERNAL_NOTIFICATION_TOPICS,
  type InternalNotificationRecipientStatus,
  type InternalNotificationTopic,
} from "./internal-notification-types";
import type { CustomerEmailProvider } from "./customer-notification-service";
import { verificationMessage } from "./internal-notification-verification-email";

const verificationLifetimeMs = 24 * 60 * 60 * 1000;

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: emailSchema,
}).strict();
const recipientIdSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(255);
const topicsSchema = z.array(z.enum(INTERNAL_NOTIFICATION_TOPICS))
  .min(1, "Select at least one notification topic")
  .refine((topics) => new Set(topics).size === topics.length, {
    message: "Notification topics must be unique",
  });

export type InternalNotificationRecipientView = Readonly<{
  id: string;
  email: string;
  status: InternalNotificationRecipientStatus;
  topics: readonly InternalNotificationTopic[];
  createdAt: Date;
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
  disabledAt: Date | null;
}>;

export type InternalNotificationRecipientActor = Readonly<{
  userId: string;
  email: string;
}>;

type VerificationValues = Readonly<{
  verificationTokenDigest: string;
  verificationIssuedAt: Date;
  verificationExpiresAt: Date;
}>;

export interface InternalNotificationRecipientRepository {
  list(): Promise<readonly InternalNotificationRecipientView[]>;
  createPending(input: Readonly<{
    actor: InternalNotificationRecipientActor;
    email: string;
    topics: readonly InternalNotificationTopic[];
    idempotencyKey: string;
  }> & VerificationValues): Promise<InternalNotificationRecipientView>;
  reissueVerification(input: Readonly<{
    actor: InternalNotificationRecipientActor;
    recipientId: string;
    idempotencyKey: string;
  }> & VerificationValues): Promise<InternalNotificationRecipientView>;
  verify(input: Readonly<{
    verificationTokenDigest: string;
    now: Date;
  }>): Promise<InternalNotificationRecipientView | null>;
  replaceSubscriptions(input: Readonly<{
    actor: InternalNotificationRecipientActor;
    recipientId: string;
    topics: readonly InternalNotificationTopic[];
    idempotencyKey: string;
    now: Date;
  }>): Promise<InternalNotificationRecipientView>;
  disable(input: Readonly<{
    actor: InternalNotificationRecipientActor;
    recipientId: string;
    idempotencyKey: string;
    now: Date;
  }>): Promise<InternalNotificationRecipientView>;
}

export class InternalNotificationRecipientValidationError extends Error {
  constructor(message = "Invalid notification recipient input") {
    super(message);
    this.name = "InternalNotificationRecipientValidationError";
  }
}

export class InternalNotificationRecipientConflictError extends Error {
  constructor(message = "Notification recipient already exists") {
    super(message);
    this.name = "InternalNotificationRecipientConflictError";
  }
}

export class InternalNotificationRecipientNotFoundError extends Error {
  constructor(message = "Notification recipient not found") {
    super(message);
    this.name = "InternalNotificationRecipientNotFoundError";
  }
}

function validationError(error: z.ZodError) {
  const message = error.issues[0]?.message;
  if (message === "Select at least one notification topic" || message === "Notification topics must be unique") {
    return new InternalNotificationRecipientValidationError(message);
  }
  return new InternalNotificationRecipientValidationError();
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function normalizeInternalNotificationEmail(value: string): string {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) throw new InternalNotificationRecipientValidationError("Invalid recipient email");
  return parsed.data;
}

function digestToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function createInternalNotificationRecipientService(
  repository: InternalNotificationRecipientRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    now?: () => Date;
    createToken?: () => string;
  }>,
) {
  function issueVerification() {
    const rawToken = dependencies.createToken?.() ?? randomBytes(32).toString("base64url");
    const issuedAt = dependencies.now?.() ?? new Date();
    return Object.freeze({
      rawToken,
      verificationTokenDigest: digestToken(rawToken),
      verificationIssuedAt: issuedAt,
      verificationExpiresAt: new Date(issuedAt.getTime() + verificationLifetimeMs),
    });
  }

  async function deliverVerification(
    recipient: InternalNotificationRecipientView,
    verification: ReturnType<typeof issueVerification>,
  ) {
    try {
      await dependencies.provider.send(verificationMessage({
        id: recipient.id,
        email: recipient.email,
        verificationIssuedAt: verification.verificationIssuedAt,
      }, verification.rawToken, dependencies.siteUrl));
      return "sent" as const;
    } catch {
      return dependencies.provider.configured ? "failed" as const : "not_configured" as const;
    }
  }

  return Object.freeze({
    list: () => repository.list(),

    async add(actorValue: unknown, inputValue: unknown) {
      const actor = parse(actorSchema, actorValue);
      const input = parse(z.object({
        email: emailSchema,
        topics: topicsSchema,
        idempotencyKey: idempotencyKeySchema,
      }).strict(), inputValue);
      const verification = issueVerification();
      const recipient = await repository.createPending({
        actor,
        email: input.email,
        topics: input.topics,
        verificationTokenDigest: verification.verificationTokenDigest,
        verificationIssuedAt: verification.verificationIssuedAt,
        verificationExpiresAt: verification.verificationExpiresAt,
        idempotencyKey: input.idempotencyKey,
      });
      const verificationDelivery = await deliverVerification(recipient, verification);
      return Object.freeze({ recipient, verificationDelivery });
    },

    async resendVerification(actorValue: unknown, inputValue: unknown) {
      const actor = parse(actorSchema, actorValue);
      const input = parse(z.object({
        recipientId: recipientIdSchema,
        idempotencyKey: idempotencyKeySchema,
      }).strict(), inputValue);
      const verification = issueVerification();
      const recipient = await repository.reissueVerification({
        actor,
        recipientId: input.recipientId,
        verificationTokenDigest: verification.verificationTokenDigest,
        verificationIssuedAt: verification.verificationIssuedAt,
        verificationExpiresAt: verification.verificationExpiresAt,
        idempotencyKey: input.idempotencyKey,
      });
      const verificationDelivery = await deliverVerification(recipient, verification);
      return Object.freeze({ recipient, verificationDelivery });
    },

    async verify(rawTokenValue: unknown) {
      const rawToken = parse(
        z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
        rawTokenValue,
      );
      return repository.verify({
        verificationTokenDigest: digestToken(rawToken),
        now: dependencies.now?.() ?? new Date(),
      });
    },

    async updateSubscriptions(actorValue: unknown, inputValue: unknown) {
      const actor = parse(actorSchema, actorValue);
      const input = parse(z.object({
        recipientId: recipientIdSchema,
        topics: topicsSchema,
        idempotencyKey: idempotencyKeySchema,
      }).strict(), inputValue);
      return repository.replaceSubscriptions({
        actor,
        recipientId: input.recipientId,
        topics: input.topics,
        idempotencyKey: input.idempotencyKey,
        now: dependencies.now?.() ?? new Date(),
      });
    },

    async disable(actorValue: unknown, inputValue: unknown) {
      const actor = parse(actorSchema, actorValue);
      const input = parse(z.object({
        recipientId: recipientIdSchema,
        idempotencyKey: idempotencyKeySchema,
      }).strict(), inputValue);
      return repository.disable({
        actor,
        recipientId: input.recipientId,
        idempotencyKey: input.idempotencyKey,
        now: dependencies.now?.() ?? new Date(),
      });
    },
  });
}
