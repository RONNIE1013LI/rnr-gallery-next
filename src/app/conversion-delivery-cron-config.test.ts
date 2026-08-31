import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("conversion delivery Cron configuration", () => {
  it("disables scheduled delivery and places retention in the aligned maintenance window", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    expect(config.crons?.some((entry) => entry.path === "/api/internal/analytics/conversion-deliveries"))
      .toBe(false);
    expect(config.crons).toContainEqual({
      path: "/api/internal/analytics/conversion-retention",
      schedule: "0 4 * * *",
    });
  });
});
