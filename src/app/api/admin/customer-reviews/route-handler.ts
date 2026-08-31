import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import type { CustomerReviewMediaKind } from "@/domain/customer-reviews/types";
import { parseAuthConfig } from "@/server/auth/config";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  getCustomerReviewRuntime,
  persistCustomerReviewMutationWithMedia,
} from "@/server/customer-reviews/customer-review-runtime";
import { CustomerReviewPolicyError } from "@/server/customer-reviews/customer-review-service";
import {
  InvalidReviewImageError,
} from "@/server/customer-reviews/customer-review-media";
import {
  assertTrustedMultipartMutationRequest,
  parseBoundedMultipartFormData,
} from "@/server/http/multipart-mutation-request";
import { MutationRequestError } from "@/server/http/mutation-request";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";
import type { UploadFile } from "@/server/uploads/local-private-upload-store";
import { PUBLIC_CACHE_TAGS, revalidatePublicCache } from "@/server/cache/public-cache-tags";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const maximumReviewFormBytes = 80 * 1024 * 1024;
const actionValues = new Set(["save_draft", "publish"]);

type AdminAccess = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
}>;

export function revalidateReviewSurfaces() {
  revalidatePublicCache([
    PUBLIC_CACHE_TAGS.reviews,
    PUBLIC_CACHE_TAGS.reviewMedia,
  ]);
  revalidatePath("/");
  revalidatePath("/au");
}

export function customerReviewErrorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (
    error instanceof ZodError ||
    error instanceof InvalidReviewImageError ||
    error instanceof CustomerReviewPolicyError ||
    error instanceof SyntaxError
  ) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  return Response.json(
    { error: "Customer review request failed" },
    { status: 500, headers: noStore },
  );
}

export function parseCustomerReviewForm(form: FormData) {
  const action = String(form.get("action") ?? "");
  if (!actionValues.has(action)) {
    throw new CustomerReviewPolicyError("Choose a valid review action");
  }
  return Object.freeze({
    action: action as "save_draft" | "publish",
    input: {
      sourcePlatform: String(form.get("sourcePlatform") ?? "FACEBOOK"),
      reviewerName: String(form.get("reviewerName") ?? ""),
      originalReviewText: String(form.get("originalReviewText") ?? ""),
      sourceReviewUrl: String(form.get("sourceReviewUrl") ?? ""),
      reviewDate: String(form.get("reviewDate") ?? ""),
      recommendationStatus: String(form.get("recommendationStatus") ?? ""),
      editorialHeadline: String(form.get("editorialHeadline") ?? ""),
      productKey: String(form.get("productKey") ?? ""),
      productDisplayLabel: String(form.get("productDisplayLabel") ?? ""),
      orderContext: String(form.get("orderContext") ?? ""),
      isHomepageFeatured: ["1", "true", "on"].includes(
        String(form.get("isHomepageFeatured") ?? "false"),
      ),
      displayOrder: String(form.get("displayOrder") ?? "0"),
      permissionStatus: String(form.get("permissionStatus") ?? ""),
      permissionEvidenceReference: String(form.get("permissionEvidenceReference") ?? ""),
      permissionNotes: String(form.get("permissionNotes") ?? ""),
      lastVerifiedAt: String(form.get("lastVerifiedAt") ?? ""),
    },
  });
}

function isUploadFile(value: FormDataEntryValue | null): value is File & UploadFile {
  if (value === null || typeof value === "string") return false;
  return value.size > 0 && typeof value.arrayBuffer === "function";
}

export function reviewMediaFiles(form: FormData) {
  const definitions = [
    ["avatar", "AVATAR"],
    ["featuredImage", "FEATURED_IMAGE"],
    ["permissionEvidence", "PERMISSION_EVIDENCE"],
  ] as const;
  return definitions.flatMap(([field, kind]) => {
    const file = form.get(field);
    return isUploadFile(file) ? [{ kind, file }] : [];
  });
}

export function customerReviewActorFrom(access: AdminAccess, request: Request) {
  const email = access.user.email?.trim();
  if (!email) throw new HttpError("Administrator email is required", 403);
  return Object.freeze({
    userId: access.user.id,
    email,
    idempotencyKey: randomUUID(),
    requestSource: new URL(request.url).pathname,
  });
}

type Dependencies = Readonly<{
  requirePermission(permission: AdminPermission): Promise<AdminAccess>;
  list(): Promise<unknown>;
  create(input: unknown, actor: ReturnType<typeof customerReviewActorFrom>, options: {
    publish: boolean;
    media: readonly Readonly<{ kind: CustomerReviewMediaKind; file: UploadFile }>[];
  }): Promise<{ id: string }>;
  origin: string;
  revalidate(): void;
}>;

export function createAdminCustomerReviewsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getCustomerReviewRuntime();
    const store = createPrivateUploadStore();
    return {
      requirePermission: requireAdminPermission,
      list: () => service.listAdmin(),
      create: async (input, actor, options) => {
        await service.validateMutation(input, { publish: options.publish });
        return persistCustomerReviewMutationWithMedia({
          store,
          actor,
          media: options.media,
          mutate: (transactionService) => transactionService.create(
            input,
            actor,
            { publish: options.publish },
          ),
        });
      },
      origin: parseAuthConfig().origin,
      revalidate: revalidateReviewSurfaces,
    };
  };

  return Object.freeze({
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        await deps.requirePermission("manage_reviews");
        return Response.json({ reviews: await deps.list() }, { headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },

    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_reviews");
        assertTrustedMultipartMutationRequest(request, deps.origin, maximumReviewFormBytes);
        const form = await parseBoundedMultipartFormData(request, maximumReviewFormBytes);
        const parsed = parseCustomerReviewForm(form);
        if (parsed.action === "publish") await deps.requirePermission("publish_reviews");
        const actor = customerReviewActorFrom(access, request);
        const review = await deps.create(parsed.input, actor, {
          publish: parsed.action === "publish",
          media: reviewMediaFiles(form),
        });
        if (parsed.action === "publish") deps.revalidate();
        return Response.json({ review }, { status: 201, headers: noStore });
      } catch (error) {
        return customerReviewErrorResponse(error);
      }
    },
  });
}

const route = createAdminCustomerReviewsRoute();
export const GET = route.GET;
export const POST = route.POST;
