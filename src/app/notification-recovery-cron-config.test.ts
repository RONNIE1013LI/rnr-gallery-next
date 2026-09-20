import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const halfHourlyRecoveryPaths = [
  "/api/internal/reply-assistant/turn-recovery",
  "/api/internal/customer-chat/review-alerts",
] as const;

describe("notification and recovery Cron topology", () => {
  it("runs customer notification recovery every 12 hours", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    expect(
      config.crons?.filter(
        (entry) => entry.path === "/api/internal/customer-notifications",
      ),
    ).toEqual([
      {
        path: "/api/internal/customer-notifications",
        schedule: "0 */12 * * *",
      },
    ]);
  });

  it("keeps assistant recovery endpoints at the aligned half-hour cadence", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    for (const path of halfHourlyRecoveryPaths) {
      expect(config.crons?.filter((entry) => entry.path === path)).toEqual([
        { path, schedule: "*/30 * * * *" },
      ]);
    }
  });
});
