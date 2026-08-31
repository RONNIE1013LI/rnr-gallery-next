import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const maintenanceSchedules = Object.freeze([
  ["/api/internal/analytics/conversion-retention", "0 4 * * *"],
  ["/api/internal/analytics/website-retention", "1 4 * * *"],
  ["/api/internal/customer-chat/retention", "2 4 * * *"],
  ["/api/internal/analytics/website-v2-reconcile", "3 4 * * *"],
  ["/api/internal/uploads/cleanup", "4 4 * * *"],
  ["/api/internal/payment-proofs/cleanup", "5 4 * * *"],
] as const);

describe("two-day maintenance Cron topology", () => {
  it("triggers each gated endpoint once inside one UTC maintenance window", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    for (const [path, schedule] of maintenanceSchedules) {
      expect(config.crons?.filter((entry) => entry.path === path)).toEqual([{ path, schedule }]);
    }
  });
});
