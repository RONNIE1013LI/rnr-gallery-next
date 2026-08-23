import { z } from "zod";

import { HttpError } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import { queryFormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import { hasFormPermission, type FormPermission } from "@/server/forms/forms-permissions";
import {
  FORM_STAT_METRICS,
  FormStatsValidationError,
  isFinanceStatMeasure,
  isFinanceStatMetric,
  parseFormStatRequest,
} from "@/server/forms/forms-stats-service";
import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const statRequestKeys = ["dimension", "timeUnit", "measure", "aggregation", "sort"] as const;
const workbenchQueryKeys = new Set(["q", "page", "perPage", "match", "sort", "direction", "preset", "filter"]);
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

function customStatisticInput(url: URL) {
  const input = queryInput(url);
  for (const key of Object.keys(input)) {
    if (!statRequestKeys.includes(key as (typeof statRequestKeys)[number]) && !workbenchQueryKeys.has(key)) {
      throw new FormStatsValidationError();
    }
  }
  return Object.fromEntries(statRequestKeys
    .filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]]));
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
        const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
        const metricValues = url.searchParams.getAll("metric");
        const hasMetric = metricValues.length > 0;
        const hasCustomStatistic = statRequestKeys.some((key) => url.searchParams.has(key));
        let statistic: Parameters<QueryStatistic>[2];

        if (hasMetric) {
          if (hasCustomStatistic) throw new FormStatsValidationError();
          if (metricValues.length !== 1) throw new FormStatsValidationError();
          const metric = z.enum(FORM_STAT_METRICS).safeParse(metricValues[0]);
          if (!metric.success) throw new FormStatsValidationError();
          if (isFinanceStatMetric(metric.data) && !canViewFinance) throw new HttpError("Forbidden", 403);
          statistic = metric.data;
        } else {
          const parsed = parseFormStatRequest(customStatisticInput(url));
          if ((isFinanceStatMeasure(parsed.measure) || parsed.dimension === "bank_recon") && !canViewFinance) {
            throw new HttpError("Forbidden", 403);
          }
          statistic = parsed;
        }
        const stat = await deps.query(parseFormWorkbenchQuery(queryInput(url)), {
          actorUserId: access.user.id,
          assignedOnly: access.formProfile?.assignedOnly ?? false,
          canViewCustomerContact: false,
          canViewFinance,
        }, statistic);
        return Response.json({ stat }, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        if (error instanceof FormStatsValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
        return Response.json({ error: "The statistic could not be loaded." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsStatsRoute();
export const GET = route.GET;
