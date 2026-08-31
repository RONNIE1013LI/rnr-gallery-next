import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("upload cleanup Cron configuration", () => {
  it("places report-first cleanup in the aligned maintenance window", async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/internal/uploads/cleanup",
      schedule: "4 4 * * *",
    });
  });
});
