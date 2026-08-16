import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import {
  createUploadCleanupRoute,
  resolveUploadCleanupConfig,
} from "./route-handler";

function request(authorization?: string) {
  return new Request("https://shop.example.test/api/internal/uploads/cleanup", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/internal/uploads/cleanup", () => {
  it("fails closed when maintenance is not configured", async () => {
    const report = vi.fn();
    const run = vi.fn();
    const response = await createUploadCleanupRoute({
      secret: null,
      deleteEnabled: false,
      report,
      run,
    })(
      request("Bearer supplied"),
    );
    expect(response.status).toBe(503);
    expect(report).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    const report = vi.fn();
    const run = vi.fn();
    const response = await createUploadCleanupRoute({
      secret: "correct",
      deleteEnabled: false,
      report,
      run,
    })(
      request("Bearer wrong"),
    );
    expect(response.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("defaults to a non-mutating aggregate report", async () => {
    const report = vi.fn().mockResolvedValue({
      eligible: 7,
      eligibleBytes: 12_345,
      storageKey: "must-not-leak.bin",
    });
    const run = vi.fn();
    const response = await createUploadCleanupRoute({
      secret: "correct",
      deleteEnabled: false,
      report,
      run,
    })(request("Bearer correct"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "report",
      eligible: 7,
      eligibleBytes: 12_345,
    });
    expect(report).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns only bounded cleanup counts when deletion is explicitly enabled", async () => {
    const report = vi.fn();
    const run = vi.fn().mockResolvedValue({
      examined: 4,
      removed: 3,
      tombstoned: 2,
      failed: 1,
      sessionsDeleted: 2,
      storageKey: "must-not-leak.bin",
    });
    const response = await createUploadCleanupRoute({
      secret: "correct",
      deleteEnabled: true,
      report,
      run,
    })(request("Bearer correct"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "delete",
      examined: 4,
      removed: 3,
      tombstoned: 2,
      failed: 1,
      sessionsDeleted: 2,
    });
    expect(report).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(100);
  });

  it("prefers CRON_SECRET and requires exact true for delete mode", () => {
    expect(resolveUploadCleanupConfig({
      CRON_SECRET: " primary ",
      MAINTENANCE_CRON_SECRET: "fallback",
      UPLOAD_CLEANUP_DELETE_ENABLED: "true",
    })).toEqual({ secret: "primary", deleteEnabled: true });
    expect(resolveUploadCleanupConfig({
      MAINTENANCE_CRON_SECRET: " fallback ",
      UPLOAD_CLEANUP_DELETE_ENABLED: "TRUE",
    })).toEqual({ secret: "fallback", deleteEnabled: false });
    expect(resolveUploadCleanupConfig({
      UPLOAD_CLEANUP_DELETE_ENABLED: "false",
    })).toEqual({ secret: null, deleteEnabled: false });
  });

  it("exports the same authenticated handler for GET and POST", () => {
    expect(GET).toBe(POST);
  });
});
