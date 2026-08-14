import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { hasAdminPermission, type AdminPermission, type AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { parseBoundedMultipartFormData, assertTrustedMultipartMutationRequest } from "@/server/http/multipart-mutation-request";
import { MutationRequestError } from "@/server/http/mutation-request";
import {
  ProductionProofConflictError,
  ProductionProofForbiddenError,
  ProductionProofNotFoundError,
  ProductionProofValidationError,
} from "@/server/production/production-proof-service";
import { InvalidUploadError, type PrivateUploadReference } from "@/server/uploads/local-private-upload-store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type ProofRuntime = ReturnType<typeof getAdminProductionProofRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  save: ProofRuntime["save"];
  remove: ProofRuntime["remove"];
  registerFile: ProofRuntime["registerFile"];
  trustedOrigin?: string;
  parseForm?: (request: Request) => Promise<Readonly<{
    kind: FormDataEntryValue | null;
    idempotencyKey: FormDataEntryValue | null;
    file: FormDataEntryValue | null;
  }>>;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionProofForbiddenError) return Response.json({ error: error.message }, { status: 403, headers: noStore });
  if (error instanceof ProductionProofNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: noStore });
  if (error instanceof ProductionProofConflictError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  if (error instanceof ProductionProofValidationError || error instanceof InvalidUploadError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  return Response.json({ error: "The file could not be uploaded." }, { status: 500, headers: noStore });
}

export function createProductionJobFilesRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const proof = getAdminProductionProofRuntime();
    return {
      requirePermission: requireAdminPermission,
      save: proof.save,
      remove: proof.remove,
      registerFile: proof.registerFile,
    };
  };
  return {
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let saved: PrivateUploadReference | null = null;
      try {
        const access = await deps.requirePermission("upload_production_files");
        assertTrustedMultipartMutationRequest(request, deps.trustedOrigin, 27 * 1024 * 1024);
        const { jobId } = await context.params;
        const parsed = deps.parseForm
          ? await deps.parseForm(request)
          : await parseBoundedMultipartFormData(request, 27 * 1024 * 1024).then((form) => ({
              kind: form.get("kind"),
              idempotencyKey: form.get("idempotencyKey"),
              file: form.get("file"),
            }));
        const { kind, idempotencyKey, file } = parsed;
        const canManageFinance = hasAdminPermission(access.adminRole, "update_production_finance");
        if (kind === "payment_proof" && !canManageFinance) {
          throw new ProductionProofForbiddenError();
        }
        if (typeof kind !== "string" || typeof idempotencyKey !== "string" || !file || typeof file === "string") {
          throw new ProductionProofValidationError();
        }
        saved = await deps.save(file);
        const result = await deps.registerFile({
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        }, jobId, { kind, idempotencyKey, reference: saved }, { canManageFinance });
        if (result.result === "duplicate") {
          await deps.remove(saved);
          saved = null;
        }
        if (result.result === "created") saved = null;
        const notification = kind === "design_draft" && result.file
          ? { result: "queued" as const }
          : null;
        return Response.json({ ...result, notification }, {
          status: result.result === "created" ? 201 : 200,
          headers: noStore,
        });
      } catch (error) {
        if (saved) await deps.remove(saved).catch(() => undefined);
        return errorResponse(error);
      }
    },
  };
}

const route = createProductionJobFilesRoute();
export const POST = route.POST;
