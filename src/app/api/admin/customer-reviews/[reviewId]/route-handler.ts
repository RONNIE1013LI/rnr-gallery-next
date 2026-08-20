import { z } from "zod";

import type { CustomerReviewMediaKind } from "@/domain/customer-reviews/types";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { parseAuthConfig } from "@/server/auth/config";
import { requireAdminPermission } from "@/server/auth/require-admin";
import {
  getCustomerReviewRuntime,
  persistCustomerReviewMutationWithMedia,
} from "@/server/customer-reviews/customer-review-runtime";
import { CustomerReviewPolicyError } from "@/server/customer-reviews/customer-review-service";
import {
  assertTrustedMultipartMutationRequest,
  parseBoundedMultipartFormData,
} from "@/server/http/multipart-mutation-request";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import type { UploadFile } from "@/server/uploads/local-private-upload-store";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";
import {
  customerReviewActorFrom,
  customerReviewErrorResponse,
  parseCustomerReviewForm,
  revalidateReviewSurfaces,
  reviewMediaFiles,
} from "../route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionSchema = z.object({ action: z.literal("archive") }).strict();
const maximumReviewFormBytes = 80 * 1024 * 1024;

type AdminAccess = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
}>;
type ReviewRecord = Readonly<{ id: string; status: string }>;
type Context = Readonly<{ params: Promise<{ reviewId: string }> }>;
type Dependencies = Readonly<{
  requirePermission(permission: AdminPermission): Promise<AdminAccess>;
  get(reviewId: string): Promise<ReviewRecord | null>;
  update(
    reviewId: string,
    input: unknown,
    actor: ReturnType<typeof customerReviewActorFrom>,
    options: {
      publish: boolean;
      media: readonly Readonly<{ kind: CustomerReviewMediaKind; file: UploadFile }>[];
    },
  ): Promise<unknown>;
  archive(
    reviewId: string,
    actor: ReturnType<typeof customerReviewActorFrom>,
  ): Promise<unknown>;
  origin: string;
  revalidate(): void;
}>;

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
}

export function createAdminCustomerReviewRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getCustomerReviewRuntime();
    const store = createPrivateUploadStore();
    return {
      requirePermission: requireAdminPermission,
      get: service.getAdmin,
      update: async (reviewId, input, actor, options) => {
        await service.validateMutation(input, { publish: options.publish });
        return persistCustomerReviewMutationWithMedia({
          store,
          actor,
          media: options.media,
          mutate: (transactionService) => transactionService.update(
            reviewId,
            input,
            actor,
            { publish: options.publish },
          ).then((review) => {
            if (!review) throw new CustomerReviewPolicyError("Review no longer exists");
            return review;
          }),
        });
      },
      archive: service.archive,
      origin: parseAuthConfig().origin,
      revalidate: revalidateReviewSurfaces,
    };
  };

  return Object.freeze({
    async GET(context: Context) {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("manage_reviews");
        const { reviewId } = await context.params;
        if (!uuidPattern.test(reviewId)) return notFound();
        const review = await deps.get(reviewId);
        return review
          ? Response.json({ review }, { headers: noStore })
          : notFound();
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },

    async PUT(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_reviews");
        assertTrustedMultipartMutationRequest(request, deps.origin, maximumReviewFormBytes);
        const { reviewId } = await context.params;
        if (!uuidPattern.test(reviewId)) return notFound();
        const current = await deps.get(reviewId);
        if (!current) return notFound();
        const form = await parseBoundedMultipartFormData(request, maximumReviewFormBytes);
        const parsed = parseCustomerReviewForm(form);
        if (current.status === "PUBLISHED" || parsed.action === "publish") {
          await deps.requirePermission("publish_reviews");
        }
        const actor = customerReviewActorFrom(access, request);
        const review = await deps.update(
          reviewId,
          parsed.input,
          actor,
          {
            publish: parsed.action === "publish",
            media: reviewMediaFiles(form),
          },
        );
        if (current.status === "PUBLISHED" || parsed.action === "publish") {
          deps.revalidate();
        }
        return Response.json({ review }, { headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },

    async PATCH(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_reviews");
        assertTrustedMutationRequest(request, deps.origin);
        const { reviewId } = await context.params;
        if (!uuidPattern.test(reviewId)) return notFound();
        actionSchema.parse(await parseBoundedJson(request, 256));
        const current = await deps.get(reviewId);
        if (!current) return notFound();
        const review = await deps.archive(
          reviewId,
          customerReviewActorFrom(access, request),
        );
        if (current.status === "PUBLISHED") deps.revalidate();
        return Response.json({ review }, { headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },
  });
}

const route = createAdminCustomerReviewRoute();
export const GET = (_request: Request, context: Context) => route.GET(context);
export const PUT = route.PUT;
export const PATCH = route.PATCH;
