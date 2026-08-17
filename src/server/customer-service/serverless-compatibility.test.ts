import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function productionFiles(root: string) {
  return execFileSync("rg", ["--files", root], { encoding: "utf8" }).trim().split("\n")
    .filter((file) => /\.(?:c|m)?(?:j|t)sx?$|\.json$/.test(file))
    .filter((file) => !/\.test\.[^.]+$/.test(file));
}

describe("reply assistant serverless compatibility", () => {
  it("does not use runtime filesystem or JSONL persistence", () => {
    const root = resolve(process.cwd(), "src/server/customer-service");
    const files = productionFiles(root)
      .filter((file) => !file.endsWith("compiled-knowledge.json"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(
      /from\s+["'](?:node:)?fs(?:\/promises)?["']|import\s*(?:\(\s*)?["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs(?:\/promises)?["']|appendFile|writeFile|createWriteStream|\.jsonl/i,
    );
  });

  it("keeps the Meta endpoint on the Node runtime", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/meta/webhook/route.ts"), "utf8");
    expect(route).toContain('runtime = "nodejs"');
    expect(route).toContain("maxDuration = 30");
  });

  it("keeps image-analysis configuration server-only", () => {
    const config = readFileSync(resolve(process.cwd(), "src/server/customer-service/config.ts"), "utf8");
    expect(config).not.toMatch(/NEXT_PUBLIC_/i);
    expect(config).toContain("BLOB_READ_WRITE_TOKEN");
    expect(config).toContain("OPENAI_IMAGE_ANALYSIS_MODEL");
  });

  it("keeps attachment source identities out of browser and reply-assistant API modules", () => {
    const root = resolve(process.cwd(), "src");
    const source = productionFiles(root)
      .filter((file) => {
        const path = relative(root, file);
        return path.startsWith("components/reply-assistant/")
          || path.startsWith("app/reply-assistant/")
          || path.startsWith("app/api/reply-assistant/");
      })
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /sourceRef|(?:raw|source|attachment|remote)Url|storageKey|attachmentIds?|externalAttachmentKey|externalKeyHash|privateStorageKey|sha256|senderHash|conversationKeyHash/i,
    );
  });
});
