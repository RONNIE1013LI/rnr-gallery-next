import { HttpError } from "@/server/auth/require-session";
import { getFormsSavedViewRuntime } from "@/server/forms/forms-saved-view-runtime";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import {
  ProductionSavedViewConflictError,
  ProductionSavedViewValidationError,
} from "@/server/production/production-saved-view-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type Dependencies = Readonly<{
  requirePermission: (permission: "manage_views") => Promise<Access>;
  remove: ReturnType<typeof getFormsSavedViewRuntime>["remove"];
  update: ReturnType<typeof getFormsSavedViewRuntime>["update"];
  trustedOrigin?: string;
}>;

export function createFormsViewRoute(dependencies?: Dependencies) {
  return {
    async PATCH(request: Request, context: { params: Promise<{ viewId: string }> }) {
      try {
        const deps: Dependencies = dependencies ?? (() => {
          const runtime = getFormsSavedViewRuntime();
          return { requirePermission: requireFormPermission, remove: runtime.remove, update: runtime.update };
        })();
        const access = await deps.requirePermission("manage_views");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { viewId } = await context.params;
        const result = await deps.update(
          { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          viewId,
          await parseBoundedJson(request),
        );
        if (result.result === "not_found") return Response.json({ error: "Saved view not found." }, { status: 404, headers: noStore });
        return Response.json(result, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError) {
          return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        }
        if (error instanceof ProductionSavedViewConflictError) {
          return Response.json({ error: error.message }, { status: 409, headers: noStore });
        }
        if (error instanceof ProductionSavedViewValidationError) {
          return Response.json({ error: error.message }, { status: 422, headers: noStore });
        }
        return Response.json({ error: "The saved view could not be updated." }, { status: 500, headers: noStore });
      }
    },
    async DELETE(request: Request, context: { params: Promise<{ viewId: string }> }) {
      try {
        const deps = dependencies ?? {
          requirePermission: requireFormPermission,
          remove: getFormsSavedViewRuntime().remove,
          update: getFormsSavedViewRuntime().update,
        };
        const access = await deps.requirePermission("manage_views");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { viewId } = await context.params;
        const result = await deps.remove(
          { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          viewId,
        );
        if (result === "not_found") return Response.json({ error: "Saved view not found." }, { status: 404, headers: noStore });
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError) {
          return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        }
        if (error instanceof ProductionSavedViewValidationError) {
          return Response.json({ error: error.message }, { status: 422, headers: noStore });
        }
        return Response.json({ error: "The saved view could not be deleted." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createFormsViewRoute();
export const PATCH = route.PATCH;
export const DELETE = route.DELETE;
