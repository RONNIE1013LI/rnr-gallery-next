import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { createFormsJobFileRoute } from "./route-handler";
import * as publicRoute from "./route";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const fileId = "e23a9f59-bf54-4bb6-a7d0-9239c14cf819";

describe("forms private file route", () => {
  it("exports the payment-proof delete handler through the Next.js route", () => {
    expect(publicRoute.DELETE).toBeTypeOf("function");
  });

  it("requires delete_files and removes only the scoped payment proof bytes", async () => {
    const access = {
      user: { id: "owner-1", email: "owner@example.test" },
      formRole: "admin" as const,
      formProfile: null,
    };
    const deletePaymentProof = vi.fn().mockResolvedValue({
      result: "deleted",
      storageKey: `${fileId}.bin`,
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    const route = createFormsJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      assertScope: vi.fn().mockResolvedValue(undefined),
      getPrivateFile: vi.fn(),
      read: vi.fn(),
      deletePaymentProof,
      remove,
      trustedOrigin: "https://shop.example.test",
    });

    const response = await route.DELETE(new Request(
      `https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`,
      { method: "DELETE", headers: { Origin: "https://shop.example.test" } },
    ), { params: Promise.resolve({ jobId, fileId }) });

    expect(response.status).toBe(204);
    expect(deletePaymentProof).toHaveBeenCalledWith(
      { userId: "owner-1", email: "owner@example.test" },
      jobId,
      fileId,
      { canDeleteFiles: true },
    );
    expect(remove).toHaveBeenCalledWith({ id: fileId, storageKey: `${fileId}.bin` });
  });

  it("requires view_files rather than view_jobs before reading private storage", async () => {
    const weakGrant = vi.fn(async (permission: string) => {
      if (permission === "view_jobs") {
        return { user: { id: "artist-1" }, formRole: "staff" as const, formProfile: null } as never;
      }
      throw new HttpError("Forbidden", 403);
    });
    const assertScope = vi.fn();
    const getPrivateFile = vi.fn();
    const read = vi.fn();
    const route = createFormsJobFileRoute({
      requirePermission: weakGrant,
      assertScope, getPrivateFile, read,
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });

    expect(response.status).toBe(403);
    expect(weakGrant).toHaveBeenCalledWith("view_files");
    expect(assertScope).not.toHaveBeenCalled();
    expect(getPrivateFile).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("allows a view_files grant through the private file route", async () => {
    const access = {
      user: { id: "artist-1" }, formRole: "staff" as const,
      formProfile: { assignedOnly: false, formPermissions: { view_files: true } } as never,
    };
    const strongGrant = vi.fn(async (permission: string) => {
      if (permission !== "view_files") throw new HttpError("Forbidden", 403);
      return access;
    });
    const read = vi.fn().mockResolvedValue(Buffer.from("abc"));
    const route = createFormsJobFileRoute({
      requirePermission: strongGrant,
      assertScope: vi.fn().mockResolvedValue(undefined),
      getPrivateFile: vi.fn().mockResolvedValue({ storageKey: `${fileId}.bin`, mediaType: "image/jpeg", originalName: "draft.jpg" }),
      read,
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });

    expect(response.status).toBe(200);
    expect(strongGrant).toHaveBeenCalledWith("view_files");
    expect(read).toHaveBeenCalledWith(`${fileId}.bin`);
  });

  it("checks forms scope and streams a job-owned file without caching", async () => {
    const access = {
      user: { id: "artist-1" }, formRole: "form_staff" as const,
      formProfile: { preset: "artist" as const, assignedOnly: true, permissions: { view_files: true, view_finance: false } as never },
    };
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const getPrivateFile = vi.fn().mockResolvedValue({ storageKey: `${fileId}.bin`, mediaType: "image/jpeg", originalName: "draft.jpg" });
    const route = createFormsJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope, getPrivateFile,
      read: vi.fn().mockResolvedValue(Buffer.from("abc")),
    });
    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });
    expect(response.status).toBe(200);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(getPrivateFile).toHaveBeenCalledWith(jobId, fileId, {
      canViewFinance: false,
      canViewPaymentProof: false,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not let Forms finance access substitute for the exact payment-proof grant", async () => {
    const access = {
      user: { id: "finance-1" }, formRole: "form_staff" as const,
      formProfile: {
        ...buildFormAccessProfile("finance"),
        permissions: {
          ...buildFormAccessProfile("finance").permissions,
          view_files: true,
          view_finance: true,
          view_payment_proof: false,
        },
      },
    };
    const getPrivateFile = vi.fn().mockImplementation(async (_jobId, _fileId, permissions) => {
      if (!permissions.canViewPaymentProof) throw new HttpError("Forbidden", 403);
      return { storageKey: `${fileId}.bin`, mediaType: "image/jpeg", originalName: "receipt.jpg" };
    });
    const route = createFormsJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      assertScope: vi.fn().mockResolvedValue(undefined),
      getPrivateFile,
      read: vi.fn(),
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });

    expect(response.status).toBe(403);
    expect(getPrivateFile).toHaveBeenCalledWith(jobId, fileId, {
      canViewFinance: true,
      canViewPaymentProof: false,
    });
  });
});
