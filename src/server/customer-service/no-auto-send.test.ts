import { describe, expect, it } from "vitest";
import {
  loadProductionRuntimeSourceInventory,
  productionSourcePathsMatching,
} from "./test-support/production-runtime-source";

const PAGE_ACCESS_TOKEN_NAME = ["META", "PAGE", "ACCESS", "TOKEN"].join("_");

describe("reply assistant has no automatic send capability", () => {
  it("contains no send route, outbound method, Graph send client or page access token", () => {
    const inventory = loadProductionRuntimeSourceInventory();
    const paths = inventory.files.map((file) => file.relativePath);
    expect(paths).toEqual(expect.arrayContaining([
      "src/app/api/meta/webhook/route-handler.ts",
      "src/app/api/reply-assistant/messages/route-handler.ts",
      "src/server/customer-service/runtime.ts",
    ]));
    expect(inventory.scriptFiles.map((file) => file.relativePath)).toContain(
      "scripts/cleanup-customer-service-attachments.ts",
    );
    expect(paths.some((file) => (
      /\.(?:test|spec)\.[^/]+$|\/(?:docs|fixtures|generated|test-support)\//.test(file)
    ))).toBe(false);
    expect(productionSourcePathsMatching(inventory.files, PAGE_ACCESS_TOKEN_NAME)).toEqual([]);
    expect(productionSourcePathsMatching(inventory.files,
      /sendMessenger|sendToMeta|sendMessage|sendReply|dispatchReply|publishReply/i,
    )).toEqual([]);
    expect(productionSourcePathsMatching(
      inventory.files,
      /graph\.facebook\.com\/.+\/messages|recipient\s*:|\/send\b/i,
    )).toEqual([]);
    expect(productionSourcePathsMatching(
      inventory.files,
      /fetch\(\s*["'`]https:\/\/graph\.facebook\.com/i,
    )).toEqual([]);
    expect(productionSourcePathsMatching(
      inventory.files,
      /graph\.facebook\.com[\s\S]{0,500}(?:method:\s*["'`]POST|\/messages\b)/i,
    )).toEqual([]);
    expect(paths.some((file) => (
      /^src\/app\/api\/(?:reply-assistant|meta)\/(?:.*\/)?send\/route\.(?:c|m)?(?:j|t)sx?$/.test(file)
    ))).toBe(false);
  });
});
