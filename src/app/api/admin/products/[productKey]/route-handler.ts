import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import {
  ProductRegistryAuthorizationError,
  ProductRegistryConflictError,
  ProductRegistryValidationError,
} from "@/server/admin/product-registry-service";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import { PUBLIC_CACHE_INVALIDATION, revalidatePublicCache } from "@/server/cache/public-cache-tags";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type RegistryRuntime = ReturnType<typeof getProductRegistryRuntime>;
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  publishProduct: RegistryRuntime["publishProduct"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
  revalidatePublic?: () => void;
}>;
type Context = Readonly<{ params: Promise<{ productKey: string }> }>;

function source(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "direct";
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductRegistryConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  if (error instanceof ProductRegistryValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof ProductRegistryAuthorizationError) {
    return Response.json({ error: error.message }, { status: 403, headers: noStore });
  }
  return Response.json(
    { error: "The product could not be published." },
    { status: 500, headers: noStore },
  );
}

export function createAdminProductRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const registry = getProductRegistryRuntime();
    return {
      requirePermission: requireAdminPermission,
      publishProduct: registry.publishProduct,
      recordFailure: recordAdminFailure,
      revalidatePublic: () => revalidatePublicCache(PUBLIC_CACHE_INVALIDATION.product),
    };
  };
  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let actor: { userId: string; email: string } | null = null;
      let productKey: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("manage_prices");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        productKey = (await context.params).productKey;
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        const result = await deps.publishProduct(actor, {
          ...body,
          productKey,
          requestSource: source(request),
        });
        deps.revalidatePublic?.();
        return Response.json(
          { result: result.result, revision: result.revision },
          { headers: noStore },
        );
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({
            actor,
            action: "product.registry.product.publish.failed",
            resourceType: "product_registry",
            ...(productKey ? { resourceId: productKey } : {}),
            requestSource: source(request),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            error,
          });
        }
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminProductRoute();
export const PATCH = route.PATCH;
