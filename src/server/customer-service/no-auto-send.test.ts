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
      "src/app/api/customer-chat/messages/route-handler.ts",
      "src/app/api/customer-chat/updates/route-handler.ts",
      "src/app/api/internal/customer-chat/retention/route-handler.ts",
      "src/app/api/reply-assistant/messages/route-handler.ts",
      "src/server/customer-service/runtime.ts",
    ]));
    expect(inventory.scriptFiles.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      "scripts/cleanup-customer-service-attachments.ts",
      "scripts/evaluate-website-customer-service.ts",
    ]));
    expect(paths.some((file) => (
      /\.(?:test|spec)\.[^/]+$|\/(?:docs|fixtures|generated|test-support)\//.test(file)
    ))).toBe(false);
    expect(productionSourcePathsMatching(inventory.files, PAGE_ACCESS_TOKEN_NAME)).toEqual([]);
    expect(productionSourcePathsMatching(inventory.serverFiles,
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
      /createOrder|placeOrder|capturePayment|markPayment|issueRefund|processRefund|applyDiscount|bookShipping|purchaseShipping|\btools\s*:/i,
    )).toEqual([]);
    expect(paths.some((file) => (
      /^src\/app\/api\/(?:reply-assistant|meta)\/(?:.*\/)?send\/route\.(?:c|m)?(?:j|t)sx?$/.test(file)
    ))).toBe(false);
  });
});
