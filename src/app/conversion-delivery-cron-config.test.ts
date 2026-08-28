import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("conversion delivery Cron configuration", () => {
  it("runs deliveries every ten minutes and retention daily", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/internal/analytics/conversion-deliveries",
      schedule: "*/10 * * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/internal/analytics/conversion-retention",
      schedule: "47 4 * * *",
    });
  });
});
