import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const recoveryPaths = [
  "/api/internal/customer-notifications",
  "/api/internal/reply-assistant/turn-recovery",
  "/api/internal/customer-chat/review-alerts",
] as const;

describe("notification and recovery Cron topology", () => {
  it("runs each recovery endpoint once at the aligned half-hour cadence", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    for (const path of recoveryPaths) {
      expect(config.crons?.filter((entry) => entry.path === path)).toEqual([
        { path, schedule: "*/30 * * * *" },
      ]);
    }
  });
});
