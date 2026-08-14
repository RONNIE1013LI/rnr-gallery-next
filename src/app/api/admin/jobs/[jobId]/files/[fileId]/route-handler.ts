import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { hasAdminPermission, type AdminPermission, type AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  ProductionProofForbiddenError,
  ProductionProofNotFoundError,
} from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type ProofRuntime = ReturnType<typeof getAdminProductionProofRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  getPrivateFile: ProofRuntime["getPrivateFile"];
  read: ProofRuntime["read"];
}>;
type Context = Readonly<{ params: Promise<{ jobId: string; fileId: string }> }>;

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "production-file";
}

export function createProductionJobFileRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const proof = getAdminProductionProofRuntime();
    return { requirePermission: requireAdminPermission, getPrivateFile: proof.getPrivateFile, read: proof.read };
  };
  return {
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_production_files");
        const { jobId, fileId } = await context.params;
        const file = await deps.getPrivateFile(jobId, fileId, {
          canViewFinance: hasAdminPermission(access.adminRole, "view_production_finance"),
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
        if (error instanceof ProductionProofNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        return Response.json({ error: "Production file is unavailable" }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createProductionJobFileRoute();
export const GET = route.GET;
