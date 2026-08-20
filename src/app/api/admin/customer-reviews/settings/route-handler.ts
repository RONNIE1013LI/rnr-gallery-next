import { z } from "zod";

import type { AdminPermission } from "@/server/auth/admin-permissions";
import { parseAuthConfig } from "@/server/auth/config";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { getCustomerReviewRuntime } from "@/server/customer-reviews/customer-review-runtime";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import {
  customerReviewActorFrom,
  customerReviewErrorResponse,
  revalidateReviewSurfaces,
} from "../route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const settingsEnvelope = z.object({
  action: z.enum(["save_draft", "publish"]),
  facebookRating: z.unknown(),
  facebookRecommendationCount: z.unknown(),
  facebookCountIsApproximate: z.unknown(),
  facebookReviewsPageUrl: z.unknown(),
  facebookLastVerifiedAt: z.unknown(),
}).strict();

type AdminAccess = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
}>;
type Dependencies = Readonly<{
  requirePermission(permission: AdminPermission): Promise<AdminAccess>;
  get(): Promise<unknown>;
  save(
    input: unknown,
    actor: ReturnType<typeof customerReviewActorFrom>,
    options: { publish: boolean },
  ): Promise<unknown>;
  origin: string;
  revalidate(): void;
}>;

export function createAdminCustomerReviewSettingsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getCustomerReviewRuntime();
    return {
      requirePermission: requireAdminPermission,
      get: service.getSettings,
      save: service.saveSettings,
      origin: parseAuthConfig().origin,
      revalidate: revalidateReviewSurfaces,
    };
  };

  return Object.freeze({
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("manage_reviews");
        return Response.json({ settings: await deps.get() }, { headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },

    async PATCH(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_reviews");
        assertTrustedMutationRequest(request, deps.origin);
        const { action, ...input } = settingsEnvelope.parse(
          await parseBoundedJson(request, 8_192),
        );
        if (action === "publish") await deps.requirePermission("publish_reviews");
        const settings = await deps.save(
          input,
          customerReviewActorFrom(access, request),
          { publish: action === "publish" },
        );
        if (action === "publish") deps.revalidate();
        return Response.json({ settings }, { headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },
  });
}

const route = createAdminCustomerReviewSettingsRoute();
export const GET = route.GET;
export const PATCH = route.PATCH;
