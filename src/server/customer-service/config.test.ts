import { describe, expect, it } from "vitest";
import { parseCustomerServiceConfig, publicCustomerServiceConfig } from "./config";

describe("customer service server config", () => {
  it("requires webhook secrets only when enabled", () => {
    expect(() => parseCustomerServiceConfig({ REPLY_ASSISTANT_ENABLED: "true" })).toThrow("META_APP_SECRET is required");
    expect(parseCustomerServiceConfig({ REPLY_ASSISTANT_ENABLED: "false" })).toMatchObject({ enabled: false });
  });

  it("requires the OpenAI key in openai mode", () => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      AI_PROVIDER: "openai",
      META_APP_SECRET: "meta-secret",
      META_VERIFY_TOKEN: "verify-secret",
      META_PAGE_ID: "page-1",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash-secret-long-enough",
    })).toThrow("OPENAI_API_KEY is required");
  });

  it("never exposes server credentials in public config", () => {
    const parsed = parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      AI_PROVIDER: "mock",
      META_APP_SECRET: "meta-secret",
      META_VERIFY_TOKEN: "verify-secret",
      META_PAGE_ID: "page-1",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash-secret-long-enough",
    });
    expect(JSON.stringify(publicCustomerServiceConfig(parsed))).not.toMatch(/meta-secret|verify-secret|hash-secret|OPENAI/i);
  });
});
