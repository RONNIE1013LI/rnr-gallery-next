import { getDatabase } from "@/server/db/client";
import {
  createDrizzleAdminOrderMutationRepository,
  getAdminOrderDetail,
  listAdminOrders,
} from "./drizzle-admin-order-repository";
import { createAdminOrderMutationService } from "./order-admin-service";
import type { NotificationDeliveryTrigger } from "@/server/notifications/immediate-notification-delivery";

export function getAdminOrderRuntime(
  onNotificationOutboxAvailable?: NotificationDeliveryTrigger,
) {
  const database = getDatabase();
  return Object.freeze({
    list: (filters: Parameters<typeof listAdminOrders>[1]) =>
      listAdminOrders(database, filters),
    detail: (orderId: string) => getAdminOrderDetail(database, orderId),
    mutations: createAdminOrderMutationService(
      createDrizzleAdminOrderMutationRepository(database),
      { onNotificationOutboxAvailable },
    ),
  });
}
