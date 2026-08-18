import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { hasAdminPermission, type AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission, type AdminAccess } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { createProductionCsv } from "@/server/production/production-operations-service";
import { parseProductionJobFilters } from "@/server/production/production-job-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = AdminAccess<Readonly<{ user: Readonly<{ id: string }> }>>;
type ProductionRuntime = ReturnType<typeof getAdminProductionRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  list: ProductionRuntime["list"];
}>;

export function createAdminProductionExportRoute(dependencies?: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        const deps = dependencies ?? (() => {
          const production = getAdminProductionRuntime();
          return { requirePermission: requireAdminPermission, list: production.list };
        })();
        const access = await deps.requirePermission("export_production_jobs");
        const query = Object.fromEntries(new URL(request.url).searchParams.entries());
        const filters = { ...parseProductionJobFilters(query), page: 1, pageSize: 5_000 };
        const result = await deps.list(filters, {
          canViewFinance: hasAdminPermission(
            access.adminRole,
            access.adminPermissions,
            "view_production_finance",
          ),
        });
        const stamp = new Date().toISOString().slice(0, 10);
        return new Response(`\uFEFF${createProductionCsv(result.items)}`, { headers: {
          ...noStore,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rnr-production-${stamp}.csv"`,
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (error) {
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        return Response.json({ error: "The production export is unavailable." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createAdminProductionExportRoute();
export const GET = route.GET;
