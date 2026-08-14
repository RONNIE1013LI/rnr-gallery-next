import { z } from "zod";

import { HttpError } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import { queryFormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import { hasFormPermission, type FormPermission } from "@/server/forms/forms-permissions";
import { FORM_STAT_METRICS, isFinanceStatMetric } from "@/server/forms/forms-stats-service";
import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type QueryStatistic = (
  query: Parameters<typeof queryFormStatistic>[1],
  access: Parameters<typeof queryFormStatistic>[2],
  metric: Parameters<typeof queryFormStatistic>[3],
) => ReturnType<typeof queryFormStatistic>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  query: QueryStatistic;
}>;

function queryInput(url: URL) {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const entries = url.searchParams.getAll(key);
    values[key] = entries.length > 1 ? entries : entries[0] ?? "";
  }
  return values;
}

export function createFormsStatsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    query: (query, access, metric) => queryFormStatistic(getDatabase(), query, access, metric),
  });
  return {
    async GET(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_stats");
        const url = new URL(request.url);
        const metric = z.enum(FORM_STAT_METRICS).safeParse(url.searchParams.get("metric"));
        if (!metric.success) return Response.json({ error: "Choose a valid statistic." }, { status: 422, headers: noStore });
        const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
        if (isFinanceStatMetric(metric.data) && !canViewFinance) throw new HttpError("Forbidden", 403);
        const stat = await deps.query(parseFormWorkbenchQuery(queryInput(url)), {
          actorUserId: access.user.id,
          assignedOnly: access.formProfile?.assignedOnly ?? false,
          canViewCustomerContact: false,
          canViewFinance,
        }, metric.data);
        return Response.json({ stat }, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        return Response.json({ error: "The statistic could not be loaded." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsStatsRoute();
export const GET = route.GET;
