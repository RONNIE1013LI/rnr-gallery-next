import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("gallery import CLI", () => {
  it("starts under the project CommonJS runtime and reports argument errors", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        join(process.cwd(), "scripts/import-wordpress-gallery.ts"),
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--manifest is required");
    expect(result.stderr).not.toContain("Top-level await");
  });
});
