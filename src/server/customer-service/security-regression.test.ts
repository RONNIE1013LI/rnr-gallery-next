import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function applicationSource() {
  const root = resolve(process.cwd(), "src");
  const files = execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n")
    .filter((file) => !/\.test\.[^.]+$/.test(file));
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("reply assistant security regression", () => {
  it("contains no Messenger sending capability or page token", () => {
    expect(applicationSource()).not.toMatch(/META_PAGE_ACCESS_TOKEN|sendMessenger|sendToMeta|graph\.facebook/i);
  });

  it("contains no hard-coded ngrok or loopback callback", () => {
    expect(applicationSource()).not.toMatch(/ngrok-free\.(?:app|dev)|localhost:8787|127\.0\.0\.1:8787/i);
  });

  it("keeps every customer service secret server-only", () => {
    expect(applicationSource()).not.toMatch(/NEXT_PUBLIC_(?:OPENAI|META|CUSTOMER_SERVICE)/i);
  });
});
