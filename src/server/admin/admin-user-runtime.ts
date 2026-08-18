import { getDatabase } from "@/server/db/client";
import {
  createAdminUserRoleService,
  createDrizzleAdminUserRoleRepository,
  listAdminUsers,
} from "./admin-user-service";
import {
  createAdminEmployeeService,
  createDrizzleAdminEmployeeRepository,
} from "./admin-employee-service";

export function getAdminUserRuntime() {
  const database = getDatabase();
  const roles = createAdminUserRoleService(createDrizzleAdminUserRoleRepository(database));
  const employees = createAdminEmployeeService({
    async getPasswordRuntime() {
      const { auth } = await import("@/server/auth");
      const context = await auth.$context;
      return {
        hashPassword: context.password.hash,
        verifyPassword: context.password.verify,
        passwordPolicy: context.password.config,
      };
    },
    create: createDrizzleAdminEmployeeRepository(database).create,
  });
  return Object.freeze({
    list: (params: Parameters<typeof listAdminUsers>[1]) => listAdminUsers(database, params),
    changeRole: roles.changeRole,
    createEmployee: employees.createEmployee,
  });
}
