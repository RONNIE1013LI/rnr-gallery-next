import { describe, expect, it } from "vitest";
import { buildAuditRecord } from "./audit-service";

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

describe("admin audit records", () => {
  it("normalizes an append-only success record", () => {
    expect(buildAuditRecord({
      actorUserId: " admin-1 ",
      actorEmail: " OWNER@EXAMPLE.TEST ",
      action: " order.status.changed ",
      resourceType: " order ",
      resourceId: " order-1 ",
      beforeSummary: { status: "new" },
      afterSummary: { status: "designing" },
      requestSource: " 192.0.2.12 ",
      result: "success",
      idempotencyKey: " status-1 ",
    })).toEqual({
      actorUserId: "admin-1",
      actorEmail: "owner@example.test",
      action: "order.status.changed",
      resourceType: "order",
      resourceId: "order-1",
      beforeSummary: { status: "new" },
      afterSummary: { status: "designing" },
      requestSource: "192.0.2.12",
      result: "success",
      idempotencyKey: "status-1",
    });
  });

  it("redacts secret-like fields recursively", () => {
    expect(buildAuditRecord({
      actorUserId: "admin-1",
      actorEmail: "owner@example.test",
      action: "payment.setting.changed",
      resourceType: "payment",
      resourceId: "stripe",
      beforeSummary: {
        enabled: false,
        secretKey: "must-not-survive",
        nested: { authorization: "must-not-survive", label: "Stripe" },
      },
      afterSummary: {
        enabled: true,
        clientSecret: "must-not-survive",
        methods: [{ provider: "stripe", accessToken: "must-not-survive" }],
      },
      result: "success",
      idempotencyKey: "payment-1",
    })).toMatchObject({
      beforeSummary: { enabled: false, nested: { label: "Stripe" } },
      afterSummary: { enabled: true, methods: [{ provider: "stripe" }] },
    });
  });

  it("does not retain employee credentials or raw failed request bodies at any depth", () => {
    const plaintextPassword = "long-lived-password-for-test";
    const passwordHash = "$2b$12$test-only-password-hash";
    const record = buildAuditRecord({
      actorUserId: "admin-1",
      actorEmail: "owner@example.test",
      action: "user.access.change.failed",
      resourceType: "user",
      afterSummary: {
        changed: false,
        credential: { password: plaintextPassword, passwordHash },
        request: { body: { initialPassword: plaintextPassword, hash: passwordHash } },
        rawRequestBody: { initialPassword: plaintextPassword },
      },
      result: "failure",
      idempotencyKey: "employee-access-failure-1",
    });

    expect(record.afterSummary).toEqual({ changed: false, request: {} });
    expect(stringsIn(record)).not.toContain(plaintextPassword);
    expect(stringsIn(record)).not.toContain(passwordHash);
  });

  it("rejects incomplete records", () => {
    expect(() => buildAuditRecord({
      actorUserId: "",
      actorEmail: "not-an-email",
      action: "",
      resourceType: "order",
      result: "success",
      idempotencyKey: "",
    })).toThrow("Invalid audit record");
  });
});
