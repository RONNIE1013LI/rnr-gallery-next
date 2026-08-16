import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("reply assistant has no automatic send capability", () => {
  it("contains no send route, Graph send client or page access token", () => {
    const root = resolve(process.cwd(), "src");
    const files = execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n");
    const customerServiceFiles = files.filter((file) => {
      const path = relative(root, file);
      return path.startsWith("server/customer-service/")
        || path.startsWith("app/api/reply-assistant/")
        || path.startsWith("app/api/meta/webhook/")
        || path.startsWith("components/reply-assistant/")
        || path.startsWith("app/reply-assistant/");
    });
    const source = customerServiceFiles
      .filter((file) => !/\.test\.[^.]+$/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/META_PAGE_ACCESS_TOKEN|sendMessenger|sendToMeta|graph\.facebook|\/send\b/i);
    expect(files.some((file) => /api\/reply-assistant\/.*\/send\/route\.ts$/.test(file))).toBe(false);
  });
});
