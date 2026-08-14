import { getDatabase } from "@/server/db/client";
import { getAdminCustomerDetail, listAdminCustomers } from "./admin-customer-service";

export function getAdminCustomerRuntime() {
  const database = getDatabase();
  return Object.freeze({
    list: (params: Parameters<typeof listAdminCustomers>[1]) => listAdminCustomers(database, params),
    detail: (key: string) => getAdminCustomerDetail(database, key),
  });
}
