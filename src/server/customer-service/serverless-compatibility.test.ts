import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProductionRuntimeSourceInventory,
  productionSourcePathsMatching,
} from "./test-support/production-runtime-source";

describe("reply assistant serverless compatibility", () => {
  it("does not use runtime filesystem or JSONL persistence", () => {
    const inventory = loadProductionRuntimeSourceInventory();
    const paths = inventory.serverFiles.map((file) => file.relativePath);
    expect(paths).toEqual(expect.arrayContaining([
      "src/app/api/meta/webhook/route-handler.ts",
      "src/app/api/reply-assistant/messages/route-handler.ts",
      "src/server/customer-service/runtime.ts",
    ]));
    expect(productionSourcePathsMatching(inventory.serverFiles,
      /from\s+["'](?:node:)?fs(?:\/promises)?["']|import\s*(?:\(\s*)?["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs(?:\/promises)?["']|appendFile|writeFile|createWriteStream|\.jsonl/i,
    )).toEqual([]);
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
    expect(productionSourcePathsMatching(
      loadProductionRuntimeSourceInventory().browserBoundaryFiles,
      /sourceRef|(?:raw|source|attachment|remote)Url|storageKey|attachmentIds?|externalAttachmentKey|externalKeyHash|privateStorageKey|sha256|senderHash|conversationKeyHash/i,
    )).toEqual([]);
  });
});
