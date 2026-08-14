import { HttpError } from "@/server/auth/require-session";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { getFormsSavedViewRuntime } from "@/server/forms/forms-saved-view-runtime";
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
type SavedRuntime = ReturnType<typeof getFormsSavedViewRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: "manage_views") => Promise<Access>;
  saved: Pick<SavedRuntime, "list" | "create">;
  trustedOrigin?: string;
}>;

function actor(access: Access) {
  return { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" };
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionSavedViewConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  if (error instanceof ProductionSavedViewValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  return Response.json({ error: "Saved views are unavailable." }, { status: 500, headers: noStore });
}

export function createFormsViewsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    saved: getFormsSavedViewRuntime(),
  });
  return {
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_views");
        return Response.json({ views: await deps.saved.list(actor(access)) }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_views");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const result = await deps.saved.create(actor(access), await parseBoundedJson(request));
        return Response.json(result, { status: result.result === "created" ? 201 : 200, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsViewsRoute();
export const GET = route.GET;
export const POST = route.POST;
