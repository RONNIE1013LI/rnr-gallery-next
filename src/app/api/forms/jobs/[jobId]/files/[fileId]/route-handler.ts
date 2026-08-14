import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { HttpError } from "@/server/auth/require-session";
import { assertFormsJobScope } from "@/server/forms/forms-job-scope";
import { hasFormPermission, type FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";
import { ProductionProofForbiddenError, ProductionProofNotFoundError } from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type ProofRuntime = ReturnType<typeof getAdminProductionProofRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  assertScope: typeof assertFormsJobScope;
  getPrivateFile: ProofRuntime["getPrivateFile"];
  read: ProofRuntime["read"];
}>;
type Context = Readonly<{ params: Promise<{ jobId: string; fileId: string }> }>;

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "production-file";
}

export function createFormsJobFileRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const proof = getAdminProductionProofRuntime();
    return { requirePermission: requireFormPermission, assertScope: assertFormsJobScope, getPrivateFile: proof.getPrivateFile, read: proof.read };
  };
  return {
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_files");
        const { jobId, fileId } = await context.params;
        await deps.assertScope(access, jobId);
        const file = await deps.getPrivateFile(jobId, fileId, {
          canViewFinance: hasFormPermission(access.formRole, access.formProfile, "view_finance"),
        });
        const bytes = await deps.read(file.storageKey);
        const attachment = new URL(request.url).searchParams.get("download") === "1";
        return new Response(new Uint8Array(bytes), { headers: {
          ...noStore,
          "Content-Type": file.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${safeFilename(file.originalName)}"`,
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (error) {
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        if (error instanceof ProductionProofForbiddenError) return Response.json({ error: error.message }, { status: 403, headers: noStore });
        if (error instanceof ProductionProofNotFoundError || error instanceof ProductionJobNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        return Response.json({ error: "Production file is unavailable" }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsJobFileRoute();
export const GET = route.GET;
