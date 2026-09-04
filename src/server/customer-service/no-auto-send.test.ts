import { describe, expect, it } from "vitest";
import {
  loadProductionRuntimeSourceInventory,
  productionSourcePathsMatching,
} from "./test-support/production-runtime-source";

const PAGE_ACCESS_TOKEN_NAME = ["META", "PAGE", "ACCESS", "TOKEN"].join("_");
const META_REPLY_SENDER_PATH = "src/server/rnr-ai/meta/reply-sender.ts";

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
    const graphMessagePaths = productionSourcePathsMatching(
      inventory.files,
      /graph\.facebook\.com\/.+\/messages|recipient\s*:|\/send\b/i,
    );
    const graphFetchPaths = productionSourcePathsMatching(
      inventory.files,
      /fetch\(\s*["'`]https:\/\/graph\.facebook\.com/i,
    );
    expect(graphMessagePaths).toEqual(
      graphMessagePaths.filter((path) => path === META_REPLY_SENDER_PATH),
    );
    expect(graphFetchPaths).toEqual(
      graphFetchPaths.filter((path) => path === META_REPLY_SENDER_PATH),
    );

    const replySender = inventory.files.find((file) => file.relativePath === META_REPLY_SENDER_PATH);
    if (replySender) {
      expect(replySender.source).toMatch(
        /if\s*\(\s*!config\.metaAutoSendEnabled\s*\)\s*\{\s*return\b/,
      );
    }
    expect(productionSourcePathsMatching(
      inventory.files,
      /createOrder|placeOrder|capturePayment|markPayment|issueRefund|processRefund|applyDiscount|bookShipping|purchaseShipping/i,
    )).toEqual([]);
    expect(paths.some((file) => (
      /^src\/app\/api\/(?:reply-assistant|meta)\/(?:.*\/)?send\/route\.(?:c|m)?(?:j|t)sx?$/.test(file)
    ))).toBe(false);
  });
});
