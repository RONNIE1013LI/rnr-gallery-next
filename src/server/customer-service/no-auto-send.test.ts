import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const PAGE_ACCESS_TOKEN_NAME = ["META", "PAGE", "ACCESS", "TOKEN"].join("_");

describe("reply assistant has no automatic send capability", () => {
  it("contains no send route, outbound method, Graph send client or page access token", () => {
    const root = resolve(process.cwd(), "src");
    const files = execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n")
      .filter((file) => /\.(?:c|m)?(?:j|t)sx?$|\.json$/.test(file));
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
    expect(source).not.toContain(PAGE_ACCESS_TOKEN_NAME);
    expect(source).not.toMatch(
      /sendMessenger|sendToMeta|sendMessage|sendReply|dispatchReply|publishReply/i,
    );
    expect(source).not.toMatch(/graph\.facebook\.com\/.+\/messages|recipient\s*:|\/send\b/i);
    expect(source).not.toMatch(/fetch\(\s*["'`]https:\/\/graph\.facebook\.com/i);
    expect(files.some((file) => /api\/reply-assistant\/.*\/send\/route\.ts$/.test(file))).toBe(false);
  });
});
