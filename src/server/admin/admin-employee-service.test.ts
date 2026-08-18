import { describe, expect, it, vi } from "vitest";
import {
  AdminEmployeeConflictError,
  AdminEmployeeValidationError,
  createAdminEmployeeService,
} from "./admin-employee-service";

const actor = Object.freeze({ userId: "admin-1", email: "owner@example.test" });

function employeeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: " Studio Artist ",
    email: "ARTIST@EXAMPLE.TEST",
    initialPassword: "long-lived-password",
    adminPermissions: ["view_orders"],
    formPermissions: { access_forms: true, view_jobs: true },
    assignedOnly: true,
    idempotencyKey: "employee-create-0001",
    ...overrides,
  };
}

describe("admin employee service", () => {
  it("hashes the initial password and forwards only its normalized record", async () => {
    const hashPassword = vi.fn().mockResolvedValue("hashed-password");
    const create = vi.fn().mockResolvedValue({
      id: "employee-1",
      name: "Studio Artist",
      email: "artist@example.test",
      role: "staff",
      created: true,
    });
    const service = createAdminEmployeeService({
      hashPassword,
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create,
    });

    await expect(service.createEmployee(actor, employeeInput())).resolves.toMatchObject({
      email: "artist@example.test",
      role: "staff",
    });
    expect(hashPassword).toHaveBeenCalledWith("long-lived-password");
    expect(create).toHaveBeenCalledWith(actor, expect.objectContaining({
      name: "Studio Artist",
      email: "artist@example.test",
      passwordHash: "hashed-password",
      profile: expect.objectContaining({
        adminPermissions: ["access_admin", "view_orders"],
        assignedOnly: true,
      }),
    }));
    expect(Object.keys(create.mock.calls[0][1])).not.toContain("initialPassword");
    expect(JSON.stringify(create.mock.calls[0][1])).not.toContain("long-lived-password");
  });

  it("rejects malformed employee inputs before hashing or persistence", async () => {
    const hashPassword = vi.fn();
    const create = vi.fn();
    const service = createAdminEmployeeService({
      hashPassword,
      passwordPolicy: { minPasswordLength: 12, maxPasswordLength: 16 },
      create,
    });

    for (const input of [
      employeeInput({ initialPassword: "too-short" }),
      employeeInput({ initialPassword: "x".repeat(17) }),
      employeeInput({ adminPermissions: ["manage_roles"] }),
      employeeInput({ adminPermissions: ["unknown_permission"] }),
      employeeInput({ formPermissions: { access_forms: "yes" } }),
      { ...employeeInput(), unexpected: true },
    ]) {
      await expect(service.createEmployee(actor, input)).rejects.toBeInstanceOf(AdminEmployeeValidationError);
    }
    expect(hashPassword).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves a safe duplicate-email conflict from the atomic repository", async () => {
    const duplicate = new AdminEmployeeConflictError("An account already uses this email.");
    const service = createAdminEmployeeService({
      hashPassword: vi.fn().mockResolvedValue("hashed-password"),
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: vi.fn().mockRejectedValue(duplicate),
    });

    await expect(service.createEmployee(actor, employeeInput())).rejects.toBe(duplicate);
  });
});
