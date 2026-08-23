import { z } from "zod";

import { HttpError } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import {
  listFormStatsLayouts,
  removeFormStatsLayout,
  saveFormStatsLayout,
} from "@/server/forms/drizzle-forms-stats-layout-repository";
import { hasFormPermission, type FormPermission } from "@/server/forms/forms-permissions";
import {
  FormStatsValidationError,
  parseFormStatsLayout,
  parseStoredFormStatsLayout,
  type FormStatsLayout,
} from "@/server/forms/forms-stats-service";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  list: (userId: string) => Promise<unknown>;
  save: (userId: string, layout: FormStatsLayout) => Promise<unknown>;
  remove: (userId: string, name: string) => Promise<boolean>;
  trustedOrigin?: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof FormStatsValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "The statistics layout request could not be completed." }, { status: 500, headers: noStore });
}

function sanitizeStoredLayouts(records: unknown, canViewFinance: boolean) {
  if (!Array.isArray(records)) throw new Error("Invalid statistics layout records");
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const candidate = record as Readonly<{ id?: unknown; name?: unknown; widgets?: unknown }>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) return [];
    try {
      const layout = parseStoredFormStatsLayout(
        { name: candidate.name, widgets: candidate.widgets },
        { canViewFinance },
      );
      return [{ id: candidate.id, ...layout }];
    } catch (error) {
      if (error instanceof FormStatsValidationError) return [];
      throw error;
    }
  });
}

export function createFormsStatsLayoutRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    list: (userId) => listFormStatsLayouts(getDatabase(), userId),
    save: (userId, layout) => saveFormStatsLayout(getDatabase(), userId, layout),
    remove: (userId, name) => removeFormStatsLayout(getDatabase(), userId, name),
  });
  return {
    async GET(request?: Request) {
      try {
        void request;
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_stats");
        const records = await deps.list(access.user.id);
        const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
        return Response.json({ layouts: sanitizeStoredLayouts(records, canViewFinance) }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async PUT(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_stats");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const layout = parseFormStatsLayout(await parseBoundedJson(request), {
          canViewFinance: hasFormPermission(access.formRole, access.formProfile, "view_finance"),
        });
        return Response.json({ layout: await deps.save(access.user.id, layout) }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async DELETE(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_stats");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const names = new URL(request.url).searchParams.getAll("name");
        if (names.length !== 1) throw new FormStatsValidationError();
        const name = z.string().trim().min(1).max(80).safeParse(names[0]);
        if (!name.success) throw new FormStatsValidationError();
        return Response.json({ removed: await deps.remove(access.user.id, name.data) }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsStatsLayoutRoute();
export const GET = route.GET;
export const PUT = route.PUT;
export const DELETE = route.DELETE;
