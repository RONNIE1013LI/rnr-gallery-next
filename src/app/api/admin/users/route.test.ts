import { describe, expect, it, vi } from "vitest";
import {
  AdminEmployeeAuthorizationError,
  AdminEmployeeConflictError,
  AdminEmployeeValidationError,
} from "@/server/admin/admin-employee-service";
import { HttpError } from "@/server/auth/require-session";
import { createAdminEmployeeRoute } from "./route-handler";

const origin = "http://localhost:3000";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Studio Artist",
    email: "artist@example.test",
    initialPassword: "long-lived-password",
    adminPermissions: ["view_orders"],
    formPermissions: { access_forms: true, view_jobs: true },
    assignedOnly: true,
    idempotencyKey: "employee-create-0001",
    ...overrides,
  };
}

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin employee route", () => {
  it("requires database-backed role management and never returns password material", async () => {
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
    });
    const createEmployee = vi.fn().mockResolvedValue({
      id: "employee-1",
      name: "Studio Artist",
      email: "artist@example.test",
      role: "staff",
      created: true,
    });
    const route = createAdminEmployeeRoute({ requirePermission, createEmployee, trustedOrigin: origin });

    const response = await route.POST(request(input()));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(createEmployee).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      expect.objectContaining({ email: "artist@example.test", requestSource: "direct" }),
    );
    const payload = JSON.stringify(await response.json());
    expect(payload).not.toContain("initialPassword");
    expect(payload).not.toContain("hashed-password");
  });

  it("rejects unauthorized and cross-origin employee creation before calling the service", async () => {
    const createEmployee = vi.fn();
    const denied = createAdminEmployeeRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      createEmployee,
      trustedOrigin: origin,
    });
    const crossOrigin = createAdminEmployeeRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
      createEmployee,
      trustedOrigin: origin,
    });

    expect((await denied.POST(request(input()))).status).toBe(403);
    expect((await crossOrigin.POST(request(input(), "https://attacker.example"))).status).toBe(403);
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it("maps validation, duplicate, and stale-admin errors without leaking request data", async () => {
    const cases = [
      [new AdminEmployeeValidationError("Choose valid employee details."), 422],
      [new AdminEmployeeConflictError("An account already uses this email."), 409],
      [new AdminEmployeeAuthorizationError("Administrator access has changed. Sign in again."), 403],
    ] as const;

    for (const [error, expectedStatus] of cases) {
      const route = createAdminEmployeeRoute({
        requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
        createEmployee: vi.fn().mockRejectedValue(error),
        trustedOrigin: origin,
      });
      const response = await route.POST(request(input()));
      expect(response.status).toBe(expectedStatus);
      expect(JSON.stringify(await response.json())).not.toContain("long-lived-password");
    }
  });

  it("rejects bounded JSON and returns an idempotent replay safely", async () => {
    const createEmployee = vi.fn().mockResolvedValue({
      id: "employee-1",
      name: "Studio Artist",
      email: "artist@example.test",
      role: "staff",
      created: false,
    });
    const route = createAdminEmployeeRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@example.test" } }),
      createEmployee,
      trustedOrigin: origin,
    });

    const oversized = await route.POST(request(input({ name: "x".repeat(256 * 1024) })));
    expect(oversized.status).toBe(413);
    expect(createEmployee).not.toHaveBeenCalled();

    const replay = await route.POST(request(input()));
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toEqual({
      result: {
        id: "employee-1",
        name: "Studio Artist",
        email: "artist@example.test",
        role: "staff",
        created: false,
      },
    });
  });
});
