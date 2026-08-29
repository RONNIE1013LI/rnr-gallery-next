import { getDatabase } from "@/server/db/client";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";
import { createDrizzleProductionProofRepository } from "./drizzle-production-proof-repository";
import { createProductionProofService } from "./production-proof-service";
import type { NotificationDeliveryTrigger } from "@/server/notifications/immediate-notification-delivery";

export function getCustomerProofRuntime(
  onNotificationOutboxAvailable?: NotificationDeliveryTrigger,
) {
  const service = createProductionProofService(
    createDrizzleProductionProofRepository(getDatabase()),
    { onNotificationOutboxAvailable },
  );
  const store = createPrivateUploadStore();
  return Object.freeze({
    listCustomerProofs: service.listCustomerProofs,
    getCustomerPrivateFile: service.getCustomerPrivateFile,
    recordCustomerReview: service.recordCustomerReview,
    read: store.read.bind(store),
  });
}
