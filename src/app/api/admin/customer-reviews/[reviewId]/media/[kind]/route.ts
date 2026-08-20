import { requireAdminPermission } from "@/server/auth/require-admin";
import { getDatabase } from "@/server/db/client";
import {
  createDrizzleCustomerReviewMediaRepository,
} from "@/server/customer-reviews/drizzle-customer-review-repository";
import { createAdminReviewMediaHandler } from "@/server/customer-reviews/customer-review-media-handler";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewId: string; kind: string }> },
) {
  const repository = createDrizzleCustomerReviewMediaRepository(getDatabase());
  const store = createPrivateUploadStore();
  const handler = createAdminReviewMediaHandler({
    requirePermission: requireAdminPermission,
    findAdmin: repository.findAdmin,
    read: store.read.bind(store),
  });
  return handler.GET(await context.params);
}
