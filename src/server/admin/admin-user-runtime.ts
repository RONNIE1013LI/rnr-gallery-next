import { getDatabase } from "@/server/db/client";
import {
  createAdminUserService,
  createDrizzleAdminUserRepository,
  listAdminUsers,
} from "./admin-user-service";
import {
  createAdminEmployeeService,
  createDrizzleAdminEmployeeRepository,
} from "./admin-employee-service";

export function getAdminUserRuntime() {
  const database = getDatabase();
  const users = createAdminUserService(createDrizzleAdminUserRepository(database));
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
    getById: users.getById,
    updateAccess: users.updateAccess,
    createEmployee: employees.createEmployee,
  });
}
