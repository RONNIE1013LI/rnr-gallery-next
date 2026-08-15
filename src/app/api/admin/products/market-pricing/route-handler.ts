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

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type RegistryRuntime = ReturnType<typeof getProductRegistryRuntime>;
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  publishMarket: RegistryRuntime["publishMarket"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;

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
    { error: "Australia prices could not be published." },
    { status: 500, headers: noStore },
  );
}

export function createAdminMarketPricingRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const registry = getProductRegistryRuntime();
    return {
      requirePermission: requireAdminPermission,
      publishMarket: registry.publishMarket,
      recordFailure: recordAdminFailure,
    };
  };
  return {
    async PATCH(request: Request) {
      const deps = dependencies ?? defaults();
      let actor: { userId: string; email: string } | null = null;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("manage_prices");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        const result = await deps.publishMarket(actor, {
          ...body,
          requestSource: source(request),
        });
        return Response.json(
          { result: result.result, revision: result.revision },
          { headers: noStore },
        );
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({
            actor,
            action: "product.registry.market.publish.failed",
            resourceType: "product_registry",
            resourceId: "AU",
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

const route = createAdminMarketPricingRoute();
export const PATCH = route.PATCH;
