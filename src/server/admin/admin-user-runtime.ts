import { getDatabase } from "@/server/db/client";
import {
  createAdminUserRoleService,
  createDrizzleAdminUserRoleRepository,
  listAdminUsers,
} from "./admin-user-service";

export function getAdminUserRuntime() {
  const database = getDatabase();
  const roles = createAdminUserRoleService(createDrizzleAdminUserRoleRepository(database));
  return Object.freeze({
    list: (params: Parameters<typeof listAdminUsers>[1]) => listAdminUsers(database, params),
    changeRole: roles.changeRole,
  });
}
