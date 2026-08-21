import { z } from "zod";

import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { HttpError } from "@/server/auth/require-session";
import { FORM_LIST_COLUMNS, type FormInlineFieldKey } from "@/domain/forms/forms-parity";
import { hasFormPermission, type FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { getCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import {
  ProductionJobConflictError,
  ProductionJobNotFoundError,
  ProductionJobValidationError,
} from "@/server/production/production-job-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type ProductionRuntime = ReturnType<typeof getAdminProductionRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  update: ProductionRuntime["update"];
  detail: ProductionRuntime["detail"];
  listFiles?: ReturnType<typeof getAdminProductionProofRuntime>["listFiles"];
  listNotifications?: ReturnType<typeof getCustomerNotificationRuntime>["listForJob"];
  assignees?: ProductionRuntime["assignees"];
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

const editableFields = new Set<string>(FORM_LIST_COLUMNS.filter((column) => column.editable).map((column) => column.key));
const envelopeSchema = z.object({
  field: z.string().refine((value): value is FormInlineFieldKey => editableFields.has(value)),
  value: z.unknown(),
  expectedUpdatedAt: z.string().datetime(),
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict();
const detailEnvelopeSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  idempotencyKey: z.string().trim().min(8).max(255),
}).passthrough();

const booleanFields = new Set<FormInlineFieldKey>([
  "fileSent", "downloaded", "customerNotified", "printed", "completed", "delivered",
]);
const financeFields = new Set<FormInlineFieldKey>(["bankRecon", "amountPaid", "amountPayable", "artistFee"]);

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionJobValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof ProductionJobNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof ProductionJobConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "The order could not be updated." }, { status: 500, headers: noStore });
}

function stringValue(value: unknown, maximum = 10_000) {
  if (typeof value !== "string" || value.length > maximum) throw new ProductionJobValidationError();
  return value;
}

function isOutsideAssignedScope(access: Access, assignedUserId: string | null | undefined) {
  return Boolean(access.formProfile?.assignedOnly && assignedUserId !== access.user.id);
}

function visibleDetail(
  detail: NonNullable<Awaited<ReturnType<ProductionRuntime["detail"]>>>,
  access: Access,
) {
  const canViewContact = hasFormPermission(
    access.formRole,
    access.formProfile,
    "view_customer_contact",
  );
  const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
  const canViewAudit = hasFormPermission(access.formRole, access.formProfile, "view_audit");
  return {
    ...detail,
    job: {
      ...detail.job,
      customerEmail: canViewContact ? detail.job.customerEmail : "",
      customerPhone: canViewContact ? detail.job.customerPhone : "",
    },
    finance: canViewFinance ? detail.finance : null,
    audit: canViewAudit ? detail.audit : [],
  };
}

async function updateFields(
  patch: z.output<typeof envelopeSchema>,
  jobId: string,
  deps: Pick<Dependencies, "detail">,
) {
  const base = {
    jobId,
    expectedUpdatedAt: patch.expectedUpdatedAt,
    idempotencyKey: patch.idempotencyKey,
  };
  if (patch.field === "urgent") {
    if (typeof patch.value !== "boolean") throw new ProductionJobValidationError();
    return { ...base, urgent: patch.value };
  }
  if (patch.field === "neededDate") return { ...base, neededDate: stringValue(patch.value, 10) };
  if (patch.field === "deliveryMethod") return { ...base, deliveryMethod: stringValue(patch.value, 40) };
  if (patch.field === "customerSource") return { ...base, customerSource: stringValue(patch.value, 40) };
  if (patch.field === "remark") return { ...base, internalNotes: stringValue(patch.value) };
  if (patch.field === "bankRecon") return { ...base, paymentReconciliationStatus: stringValue(patch.value, 40) };
  if (patch.field === "artist") {
    if (patch.value !== null && typeof patch.value !== "string") throw new ProductionJobValidationError();
    return { ...base, assignedUserId: patch.value || null };
  }
  if (patch.field === "assignArtist") {
    if (patch.value !== false) throw new ProductionJobValidationError("Choose an artist to assign this job");
    return { ...base, assignedUserId: null };
  }
  if (booleanFields.has(patch.field)) {
    if (typeof patch.value !== "boolean") throw new ProductionJobValidationError();
    return { ...base, milestones: { [patch.field]: patch.value } };
  }
  if (financeFields.has(patch.field)) {
    if (!Number.isInteger(patch.value) || Number(patch.value) < 0) throw new ProductionJobValidationError();
    const detail = await deps.detail(jobId, { canViewFinance: true });
    if (!detail) throw new ProductionJobNotFoundError();
    if (detail.job.source === "web") {
      throw new ProductionJobValidationError("Linked web order totals are read-only");
    }
    if (!detail.finance) throw new ProductionJobValidationError("Finance data is unavailable");
    const finance = {
      manualPaymentStatus: detail.paymentStatus,
      amountPayableCents: detail.finance.amountPayableCents,
      amountPaidCents: detail.finance.amountPaidCents,
      artistFeeCents: detail.finance.artistFeeCents ?? 0,
      materialCostCents: detail.finance.materialCostCents ?? 0,
    };
    if (patch.field === "amountPayable") finance.amountPayableCents = Number(patch.value);
    if (patch.field === "amountPaid") finance.amountPaidCents = Number(patch.value);
    if (patch.field === "artistFee") finance.artistFeeCents = Number(patch.value);
    return { ...base, finance };
  }
  throw new ProductionJobValidationError();
}

export function createFormsJobRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const production = getAdminProductionRuntime();
    const proof = getAdminProductionProofRuntime();
    return {
      requirePermission: requireFormPermission,
      update: production.update,
      detail: production.detail,
      listFiles: proof.listFiles,
      listNotifications: getCustomerNotificationRuntime().listForJob,
      assignees: production.assignees,
    };
  };
  return {
    async GET(_request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_jobs");
        const { jobId } = await context.params;
        const detail = await deps.detail(jobId, {
          canViewFinance: hasFormPermission(access.formRole, access.formProfile, "view_finance"),
        });
        if (!detail || isOutsideAssignedScope(access, detail.job.assignedUserId)) {
          throw new ProductionJobNotFoundError();
        }
        const canViewFiles = hasFormPermission(access.formRole, access.formProfile, "view_files");
        const canUpdate = hasFormPermission(access.formRole, access.formProfile, "update_jobs");
        const [proofing, notifications, assignees] = await Promise.all([
          canViewFiles && deps.listFiles
            ? deps.listFiles(jobId, {
                canViewFinance: hasFormPermission(access.formRole, access.formProfile, "view_finance"),
                canViewPaymentProof: hasFormPermission(access.formRole, access.formProfile, "view_payment_proof"),
              })
            : Promise.resolve({ files: [], revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false } }),
          canViewFiles && deps.listNotifications ? deps.listNotifications(jobId) : Promise.resolve([]),
          canUpdate && deps.assignees ? deps.assignees() : Promise.resolve([]),
        ]);
        return Response.json({
          detail: visibleDetail(detail, access),
          files: proofing.files,
          revision: proofing.revision,
          notifications,
          assignees,
        }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async PATCH(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("update_jobs");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request);
        const patch = envelopeSchema.safeParse(body);
        const detailPatch = detailEnvelopeSchema.safeParse(body);
        if (!patch.success && (!detailPatch.success || (body && typeof body === "object" && "field" in body))) {
          throw new ProductionJobValidationError();
        }
        const { jobId } = await context.params;
        if (access.formProfile?.assignedOnly) {
          const current = await deps.detail(jobId, { canViewFinance: false });
          if (!current || isOutsideAssignedScope(access, current.job.assignedUserId)) {
            throw new ProductionJobNotFoundError();
          }
        }
        if (!patch.success) {
          if (!detailPatch.success) throw new ProductionJobValidationError();
          const full = detailPatch.data;
          const milestones = full.milestones && typeof full.milestones === "object"
            ? full.milestones as Record<string, unknown>
            : null;
          const changesFinance = Boolean(full.finance) || "paymentReconciliationStatus" in full || Boolean(milestones?.artistPaid);
          if (changesFinance && !hasFormPermission(access.formRole, access.formProfile, "update_finance")) {
            throw new HttpError("Forbidden", 403);
          }
          if (milestones && Object.keys(milestones).some((key) => key !== "delivered" && key !== "artistPaid") &&
            !hasFormPermission(access.formRole, access.formProfile, "update_production_status")) {
            throw new HttpError("Forbidden", 403);
          }
          if (milestones && "delivered" in milestones &&
            !hasFormPermission(access.formRole, access.formProfile, "update_delivery_status")) {
            throw new HttpError("Forbidden", 403);
          }
          const result = await deps.update(
            { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
            { ...full, jobId },
            { canUpdateFinance: hasFormPermission(access.formRole, access.formProfile, "update_finance") },
          );
          const refreshed = await deps.detail(jobId, { canViewFinance: false });
          return Response.json({
            result,
            version: refreshed?.job.updatedAt.toISOString() ?? full.expectedUpdatedAt,
          }, { headers: noStore });
        }
        if (financeFields.has(patch.data.field) && !hasFormPermission(access.formRole, access.formProfile, "update_finance")) {
          throw new HttpError("Forbidden", 403);
        }
        if (booleanFields.has(patch.data.field)) {
          const permission = patch.data.field === "delivered" ? "update_delivery_status" : "update_production_status";
          if (!hasFormPermission(access.formRole, access.formProfile, permission)) throw new HttpError("Forbidden", 403);
        }
        const fields = await updateFields(patch.data, jobId, deps);
        const result = await deps.update(
          { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          fields,
          { canUpdateFinance: hasFormPermission(access.formRole, access.formProfile, "update_finance") },
        );
        const refreshed = await deps.detail(jobId, { canViewFinance: false });
        return Response.json({
          result,
          version: refreshed?.job.updatedAt.toISOString() ?? patch.data.expectedUpdatedAt,
        }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsJobRoute();
export const GET = route.GET;
export const PATCH = route.PATCH;
