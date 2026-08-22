import { randomUUID } from "node:crypto";

import { buildAuditRecord } from "@/server/admin/audit-service";
import { HttpError } from "@/server/auth/require-session";
import { adminAuditLogs } from "@/server/db/schema";
import {
  listFormOrders,
  type FormWorkbenchAccess,
} from "@/server/forms/drizzle-forms-workbench-repository";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import {
  createFormsCsv,
  parseFormWorkbenchQuery,
  type FormOrderRow,
  type FormWorkbenchQuery,
} from "@/server/forms/forms-workbench-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = FormAccess<Readonly<{
  user: Readonly<{ id: string; name?: string; email?: string }>;
}>>;
type ExportAudit = Readonly<{
  actorUserId: string;
  actorEmail: string;
  rowCount: number;
  filterCount: number;
}>;
type Dependencies = Readonly<{
  requirePermission: (permission: "export_jobs") => Promise<Access>;
  list: (query: FormWorkbenchQuery, access: FormWorkbenchAccess) => ReturnType<typeof listFormOrders>;
  recordExport: (input: ExportAudit) => Promise<unknown>;
}>;

function queryRecord(searchParams: URLSearchParams) {
  return Object.fromEntries([...searchParams.keys()].map((key) => {
    const values = searchParams.getAll(key);
    return [key, values.length > 1 ? values : values[0]];
  }));
}

async function defaultRecordExport(input: ExportAudit) {
  const { getDatabase } = await import("@/server/db/client");
  await getDatabase().insert(adminAuditLogs).values(buildAuditRecord({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "forms.jobs.exported",
    resourceType: "production_job",
    afterSummary: { rowCount: input.rowCount, filterCount: input.filterCount },
    requestSource: "forms.jobs.export",
    result: "success",
    idempotencyKey: `forms-export:${randomUUID()}`,
  }));
}

export function createFormsJobsExportRoute(dependencies?: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        const deps = dependencies ?? {
          requirePermission: requireFormPermission,
          list: async (query: FormWorkbenchQuery, access: FormWorkbenchAccess) => {
            const { getDatabase } = await import("@/server/db/client");
            return listFormOrders(getDatabase(), query, access);
          },
          recordExport: defaultRecordExport,
        };
        const actor = await deps.requirePermission("export_jobs");
        const query = parseFormWorkbenchQuery(queryRecord(new URL(request.url).searchParams));
        const canViewFinance = hasFormPermission(actor.formRole, actor.formProfile, "view_finance");
        const canViewCustomerContact = hasFormPermission(actor.formRole, actor.formProfile, "view_customer_contact");
        const canViewPaymentProof = hasFormPermission(actor.formRole, actor.formProfile, "view_payment_proof");
        const access: FormWorkbenchAccess = {
          actorUserId: actor.user.id,
          assignedOnly: actor.formProfile?.assignedOnly ?? false,
          canViewCustomerContact,
          canViewFinance,
          canViewPaymentProof,
        };
        const rows: FormOrderRow[] = [];
        let page = 1;
        let total = 0;
        do {
          const result = await deps.list({ ...query, page, pageSize: 100 }, access);
          rows.push(...result.items);
          total = result.total;
          page += 1;
        } while (rows.length < Math.min(total, 5_000));
        await deps.recordExport({
          actorUserId: actor.user.id,
          actorEmail: actor.user.email ?? "unknown@invalid.local",
          rowCount: rows.length,
          filterCount: query.conditions.length,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        return new Response(`\uFEFF${createFormsCsv(rows, { canViewFinance, canViewCustomerContact })}`, {
          headers: {
            ...noStore,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="rnr-orders-${stamp}.csv"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        }
        return Response.json({ error: "The order export is unavailable." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsJobsExportRoute();
export const GET = route.GET;
