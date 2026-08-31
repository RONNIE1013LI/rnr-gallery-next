import { getAdminContentRuntime } from "@/server/admin/admin-content-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import { ContentValidationError } from "@/server/admin/content-service";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import {
  PUBLIC_CACHE_TAGS,
  revalidatePublicCache,
} from "@/server/cache/public-cache-tags";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type ContentRuntime = ReturnType<typeof getAdminContentRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  saveDraft: ContentRuntime["saveDraft"];
  publish: ContentRuntime["publish"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
  revalidatePublic?: () => void;
}>;
type Context = Readonly<{ params: Promise<{ key: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ContentValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  return Response.json({ error: "Content could not be saved." }, { status: 500, headers: noStore });
}

function source(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "direct";
}

export function createAdminContentRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const runtime = getAdminContentRuntime();
    return {
      requirePermission: requireAdminPermission,
      saveDraft: runtime.saveDraft,
      publish: runtime.publish,
      recordFailure: recordAdminFailure,
      revalidatePublic: () => revalidatePublicCache([PUBLIC_CACHE_TAGS.content]),
    };
  };
  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let actor: Readonly<{ userId: string; email: string }> | null = null;
      let key: string | undefined;
      let idempotencyKey: string | undefined;
      let auditAction = "content.mutation.failed";
      try {
        const access = await deps.requirePermission("manage_content");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        const resolved = await context.params;
        key = resolved.key;
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        auditAction = body.action === "publish" ? "content.publish.failed" : body.action === "save" ? "content.draft.save.failed" : "content.mutation.failed";
        const input = {
          key: resolved.key,
          value: body.value,
          idempotencyKey: String(body.idempotencyKey ?? ""),
          requestSource: source(request),
        };
        if (body.action === "save") {
          return Response.json({ result: await deps.saveDraft(actor, input) }, { headers: noStore });
        }
        if (body.action === "publish") {
          await deps.requirePermission("publish_content");
          const result = await deps.publish(actor, input);
          deps.revalidatePublic?.();
          return Response.json({ result }, { headers: noStore });
        }
        throw new ContentValidationError("Unknown content action");
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({ actor, action: auditAction, resourceType: "content", ...(key ? { resourceId: key } : {}), requestSource: source(request), ...(idempotencyKey ? { idempotencyKey } : {}), error });
        }
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminContentRoute();
export const PATCH = route.PATCH;
