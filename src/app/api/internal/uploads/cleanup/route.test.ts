import { describe, expect, it, vi } from "vitest";
import { createUploadCleanupRoute } from "./route-handler";

function request(authorization?: string) {
  return new Request("https://shop.example.test/api/internal/uploads/cleanup", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/internal/uploads/cleanup", () => {
  it("fails closed when maintenance is not configured", async () => {
    const run = vi.fn();
    const response = await createUploadCleanupRoute({ secret: null, run })(
      request("Bearer supplied"),
    );
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    const run = vi.fn();
    const response = await createUploadCleanupRoute({ secret: "correct", run })(
      request("Bearer wrong"),
    );
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns only bounded cleanup counts", async () => {
    const run = vi.fn().mockResolvedValue({
      examined: 4,
      removed: 3,
      failed: 1,
      sessionsDeleted: 2,
      storageKey: "must-not-leak.bin",
    });
    const response = await createUploadCleanupRoute({ secret: "correct", run })(
      request("Bearer correct"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      examined: 4,
      removed: 3,
      failed: 1,
      sessionsDeleted: 2,
    });
    expect(run).toHaveBeenCalledWith(50);
  });
});
