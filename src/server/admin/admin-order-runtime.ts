import { getDatabase } from "@/server/db/client";
import {
  createDrizzleAdminOrderMutationRepository,
  getAdminOrderDetail,
  listAdminOrders,
} from "./drizzle-admin-order-repository";
import { createAdminOrderMutationService } from "./order-admin-service";

export function getAdminOrderRuntime() {
  const database = getDatabase();
  return Object.freeze({
    list: (filters: Parameters<typeof listAdminOrders>[1]) =>
      listAdminOrders(database, filters),
    detail: (orderId: string) => getAdminOrderDetail(database, orderId),
    mutations: createAdminOrderMutationService(
      createDrizzleAdminOrderMutationRepository(database),
    ),
  });
}
