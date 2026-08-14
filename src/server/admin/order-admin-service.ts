import type {
  OrderFulfilmentStatus,
  OrderPaymentStatus,
} from "@/server/db/schema/orders";
import { z } from "zod";

export type AdminOrderSort = "created" | "updated" | "total";
export type AdminOrderSortDirection = "asc" | "desc";

export type AdminOrderFilters = Readonly<{
  query: string;
  paymentStatus?: OrderPaymentStatus;
  fulfilmentStatus?: OrderFulfilmentStatus;
  country?: "NZ" | "AU";
  deliveryMethod?: "post" | "pickup";
  urgent?: boolean;
  from?: string;
  to?: string;
  validationMessage?: string;
  page: number;
  pageSize: number;
  sort: AdminOrderSort;
  direction: AdminOrderSortDirection;
}>;

const paymentStatuses = new Set<OrderPaymentStatus>([
  "awaiting_payment",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "refunded",
]);

export const fulfilmentStatuses = Object.freeze([
  "new",
  "designing",
  "awaiting_customer",
  "ready_to_print",
  "printing",
  "on_hold",
  "shipped",
  "completed",
  "cancelled",
] as const satisfies readonly OrderFulfilmentStatus[]);

const fulfilmentStatusSet = new Set<OrderFulfilmentStatus>(fulfilmentStatuses);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoCalendarDate(value: string | undefined) {
  if (!value || !isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function parseAdminOrderFilters(
  input: Readonly<Record<string, string | string[] | undefined>>,
): AdminOrderFilters {
  const query = (scalar(input.q) ?? "").trim().slice(0, 120);
  const payment = scalar(input.payment);
  const status = scalar(input.status);
  const country = scalar(input.country);
  const delivery = scalar(input.delivery);
  const urgent = scalar(input.urgent);
  const from = scalar(input.from);
  const to = scalar(input.to);
  const sort = scalar(input.sort);
  const direction = scalar(input.direction);
  const page = positiveInteger(scalar(input.page), 1);
  const pageSize = Math.min(100, positiveInteger(scalar(input.pageSize), 25));
  const fromIsValid = isValidIsoCalendarDate(from);
  const toIsValid = isValidIsoCalendarDate(to);
  const hasInvalidCalendarDate = Boolean(
    (from && isoDatePattern.test(from) && !fromIsValid)
    || (to && isoDatePattern.test(to) && !toIsValid),
  );

  return Object.freeze({
    query,
    ...(paymentStatuses.has(payment as OrderPaymentStatus)
      ? { paymentStatus: payment as OrderPaymentStatus }
      : {}),
    ...(fulfilmentStatusSet.has(status as OrderFulfilmentStatus)
      ? { fulfilmentStatus: status as OrderFulfilmentStatus }
      : {}),
    ...(country === "NZ" || country === "AU" ? { country } : {}),
    ...(delivery === "post" || delivery === "pickup"
      ? { deliveryMethod: delivery }
      : {}),
    ...(urgent === "yes" ? { urgent: true } : urgent === "no" ? { urgent: false } : {}),
    ...(fromIsValid ? { from } : {}),
    ...(toIsValid ? { to } : {}),
    ...(hasInvalidCalendarDate
      ? { validationMessage: "Enter valid From and To dates." }
      : {}),
    page,
    pageSize,
    sort: sort === "updated" || sort === "total" ? sort : "created",
    direction: direction === "asc" ? "asc" : "desc",
  });
}

const transitions: Readonly<Record<OrderFulfilmentStatus, readonly OrderFulfilmentStatus[]>> = {
  new: ["designing", "on_hold", "cancelled"],
  designing: ["awaiting_customer", "on_hold", "cancelled"],
  awaiting_customer: ["designing", "ready_to_print", "on_hold", "cancelled"],
  ready_to_print: ["printing", "on_hold", "cancelled"],
  printing: ["shipped", "on_hold", "cancelled"],
  on_hold: ["designing", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

const productionStatuses = new Set<OrderFulfilmentStatus>([
  "designing",
  "awaiting_customer",
  "ready_to_print",
  "printing",
  "shipped",
  "completed",
]);

export function isOrderStatusTransitionAllowed(
  from: OrderFulfilmentStatus,
  to: OrderFulfilmentStatus,
): boolean {
  return transitions[from].includes(to);
}

export function getAllowedOrderStatusTransitions(
  from: OrderFulfilmentStatus,
): readonly OrderFulfilmentStatus[] {
  return transitions[from];
}

export class AdminOrderValidationError extends Error {
  constructor(message = "Order update is invalid") {
    super(message);
    this.name = "AdminOrderValidationError";
  }
}

export class AdminOrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "AdminOrderNotFoundError";
  }
}

export class AdminOrderConflictError extends Error {
  constructor(message = "Order changed before the update was saved") {
    super(message);
    this.name = "AdminOrderConflictError";
  }
}

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();

const mutationBaseSchema = z.object({
  orderId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(255),
  requestSource: z.string().trim().min(1).max(255).optional(),
});

const statusChangeSchema = mutationBaseSchema.extend({
  toStatus: z.enum(fulfilmentStatuses),
  reason: z.string().trim().max(500).optional(),
}).strict();

const noteSchema = mutationBaseSchema.extend({
  visibility: z.enum(["internal", "customer"]),
  body: z.string().trim().min(1).max(2_000),
}).strict();

const trackingSchema = mutationBaseSchema.extend({
  carrier: z.string().trim().min(1).max(120),
  trackingNumber: z.string().trim().min(1).max(160),
  trackingUrl: z.string().trim().url().startsWith("https://").max(2_000).optional(),
}).strict();

type AdminActor = z.output<typeof actorSchema>;
type StatusChangeInput = z.output<typeof statusChangeSchema>;
type NoteInput = z.output<typeof noteSchema>;
type TrackingInput = z.output<typeof trackingSchema>;
type MutationResult = "updated" | "created" | "duplicate" | "conflict";

export interface AdminOrderMutationRepository {
  findStatusChange(
    orderId: string,
    idempotencyKey: string,
  ): Promise<OrderFulfilmentStatus | null>;
  getStatus(orderId: string): Promise<OrderFulfilmentStatus | null>;
  getPaymentStatus(orderId: string): Promise<OrderPaymentStatus | null>;
  applyStatusChange(
    input: StatusChangeInput & Readonly<{
      fromStatus: OrderFulfilmentStatus;
      actor: AdminActor;
    }>,
  ): Promise<"updated" | "duplicate" | "conflict">;
  addNote(
    input: NoteInput & Readonly<{ actor: AdminActor }>,
  ): Promise<"created" | "duplicate">;
  setTracking(
    input: TrackingInput & Readonly<{ actor: AdminActor }>,
  ): Promise<"updated" | "duplicate" | "conflict">;
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AdminOrderValidationError();
  return result.data;
}

function resolveMutationResult(result: MutationResult) {
  if (result === "conflict") throw new AdminOrderConflictError();
  return result;
}

export function createAdminOrderMutationService(
  repository: AdminOrderMutationRepository,
) {
  return Object.freeze({
    async changeStatus(actorInput: unknown, input: unknown) {
      const actor = parseOrThrow(actorSchema, actorInput);
      const parsed = parseOrThrow(statusChangeSchema, input);
      const priorRequest = await repository.findStatusChange(
        parsed.orderId,
        parsed.idempotencyKey,
      );
      if (priorRequest) {
        if (priorRequest !== parsed.toStatus) {
          throw new AdminOrderConflictError("Idempotency key was already used");
        }
        return "duplicate" as const;
      }
      const fromStatus = await repository.getStatus(parsed.orderId);
      if (!fromStatus) throw new AdminOrderNotFoundError();
      if (!isOrderStatusTransitionAllowed(fromStatus, parsed.toStatus)) {
        throw new AdminOrderValidationError(
          `Cannot move an order from ${fromStatus} to ${parsed.toStatus}`,
        );
      }
      if (productionStatuses.has(parsed.toStatus)) {
        const paymentStatus = await repository.getPaymentStatus(parsed.orderId);
        if (paymentStatus !== "paid") {
          throw new AdminOrderValidationError(
            "Payment must be confirmed before production can begin",
          );
        }
      }
      return resolveMutationResult(await repository.applyStatusChange({
        ...parsed,
        fromStatus,
        actor,
      }));
    },

    async addNote(actorInput: unknown, input: unknown) {
      const actor = parseOrThrow(actorSchema, actorInput);
      const parsed = parseOrThrow(noteSchema, input);
      return repository.addNote({ ...parsed, actor });
    },

    async setTracking(actorInput: unknown, input: unknown) {
      const actor = parseOrThrow(actorSchema, actorInput);
      const parsed = parseOrThrow(trackingSchema, input);
      return resolveMutationResult(await repository.setTracking({
        ...parsed,
        actor,
      }));
    },
  });
}
