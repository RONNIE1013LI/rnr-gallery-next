import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  AdminEmployeeConflictError,
  AdminEmployeeValidationError,
  createAdminEmployeeService,
  sameStaffAccessProfile,
} from "./admin-employee-service";
import { normalizeStaffAccessProfile } from "@/server/auth/staff-access-profile";

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
    const verifyPassword = vi.fn().mockResolvedValue(true);
    const create = vi.fn().mockResolvedValue({
      id: "employee-1",
      name: "Studio Artist",
      email: "artist@example.test",
      role: "staff",
      created: true,
    });
    const service = createAdminEmployeeService({
      hashPassword,
      verifyPassword,
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
    }), expect.any(Function));
    expect(Object.keys(create.mock.calls[0][1])).not.toContain("initialPassword");
    expect(JSON.stringify(create.mock.calls[0][1])).not.toContain("long-lived-password");
    await expect(create.mock.calls[0][2]("stored-better-auth-hash")).resolves.toBe(true);
    expect(verifyPassword).toHaveBeenCalledWith({
      password: "long-lived-password",
      hash: "stored-better-auth-hash",
    });
  });

  it("rejects malformed employee inputs before hashing or persistence", async () => {
    const hashPassword = vi.fn();
    const create = vi.fn();
    const service = createAdminEmployeeService({
      hashPassword,
      verifyPassword: vi.fn(),
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
      verifyPassword: vi.fn(),
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: vi.fn().mockRejectedValue(duplicate),
    });

    await expect(service.createEmployee(actor, employeeInput())).rejects.toBe(duplicate);
  });

  it("binds an idempotent replay to the supplied initial password without persisting it", async () => {
    const create = vi.fn(async (_actor, _input, verifyReplayPassword) => {
      if (!await verifyReplayPassword("stored-better-auth-hash")) {
        throw new AdminEmployeeConflictError("This employee-creation request has already been used.");
      }
      return { id: "employee-1", name: "Studio Artist", email: "artist@example.test", role: "staff" as const, created: false };
    });
    const service = createAdminEmployeeService({
      hashPassword: vi.fn().mockResolvedValue("new-hash"),
      verifyPassword: vi.fn().mockResolvedValue(false),
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create,
    });

    await expect(service.createEmployee(actor, employeeInput())).rejects.toBeInstanceOf(AdminEmployeeConflictError);
    expect(JSON.stringify(create.mock.calls[0][1])).not.toContain("long-lived-password");
  });

  it("compares normalised profiles structurally regardless of JSON object key order", () => {
    const profile = normalizeStaffAccessProfile({
      adminPermissions: ["view_orders"],
      formPermissions: { access_forms: true, view_jobs: true },
      assignedOnly: true,
    });
    const storedWithReorderedKeys = {
      adminPermissions: [...profile.adminPermissions],
      formPermissions: Object.fromEntries(Object.entries(profile.formPermissions).reverse()),
      assignedOnly: true,
    };

    expect(sameStaffAccessProfile(storedWithReorderedKeys, profile)).toBe(true);
  });

  it("uses the pinned Better Auth hash and verification implementations compatibly", async () => {
    const password = "test-only-initial-password";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(verifyPassword({ hash, password })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: "different-test-password" })).resolves.toBe(false);
  });
});
