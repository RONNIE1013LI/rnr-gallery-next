import { getDatabase } from "@/server/db/client";
import {
  createDrizzleCustomerReviewMediaRepository,
} from "@/server/customer-reviews/drizzle-customer-review-repository";
import {
  createCachedPublicReviewMediaLookup,
  createPublicReviewMediaHandler,
} from "@/server/customer-reviews/customer-review-media-handler";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";

const findPublic = createCachedPublicReviewMediaLookup((reviewId, kind) => (
  createDrizzleCustomerReviewMediaRepository(getDatabase()).findPublic(reviewId, kind)
));

export async function GET(
  request: Request,
  context: { params: Promise<{ reviewId: string; kind: string }> },
) {
  const store = createPrivateUploadStore();
  const handler = createPublicReviewMediaHandler({
    findPublic,
    read: store.read.bind(store),
  });
  return handler.GET(request, await context.params);
}
