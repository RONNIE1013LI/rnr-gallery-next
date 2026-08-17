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
    expect(JSON.stringify(publicCustomerServiceConfig(parsed))).not.toMatch(/meta-secret|verify-secret|hash-secret|OPENAI|image|blob|attachment/i);
  });

  it("keeps image analysis disabled by default", () => {
    expect(parseCustomerServiceConfig({}).imageAnalysisEnabled).toBe(false);
  });

  it("bounds the server-side conversation debounce window", () => {
    expect(parseCustomerServiceConfig({}).conversationDebounceMs).toBe(2_000);
    expect(parseCustomerServiceConfig({ REPLY_ASSISTANT_DEBOUNCE_MS: "750" }).conversationDebounceMs).toBe(750);
    expect(() => parseCustomerServiceConfig({ REPLY_ASSISTANT_DEBOUNCE_MS: "249" }))
      .toThrow("REPLY_ASSISTANT_DEBOUNCE_MS must be between 250 and 10000");
    expect(() => parseCustomerServiceConfig({ REPLY_ASSISTANT_DEBOUNCE_MS: "10001" }))
      .toThrow("REPLY_ASSISTANT_DEBOUNCE_MS must be between 250 and 10000");
  });

  it("requires an image model when image analysis is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      META_APP_SECRET: "app",
      META_VERIFY_TOKEN: "verify",
      META_PAGE_ID: "page",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
    })).toThrow("OPENAI_IMAGE_ANALYSIS_MODEL is required");
  });

  it("requires a private Blob token when image analysis is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      META_APP_SECRET: "app",
      META_VERIFY_TOKEN: "verify",
      META_PAGE_ID: "page",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "gpt-vision",
    })).toThrow("BLOB_READ_WRITE_TOKEN is required");
  });

  it("requires an allowed HTTPS host when image analysis is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      META_APP_SECRET: "app",
      META_VERIFY_TOKEN: "verify",
      META_PAGE_ID: "page",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "gpt-vision",
      BLOB_READ_WRITE_TOKEN: "blob-token",
    })).toThrow("META_ATTACHMENT_ALLOWED_HOSTS is required");
  });

  it("requires server-only source encryption and recovery runner secrets", () => {
    const base = {
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "test-image-model",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      META_ATTACHMENT_ALLOWED_HOSTS: "cdn.facebook.com",
    };
    expect(() => parseCustomerServiceConfig(base))
      .toThrow("CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY is required");
    expect(() => parseCustomerServiceConfig({
      ...base,
      CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY: "source-encryption-secret-at-least-32-bytes",
    })).toThrow("REPLY_ASSISTANT_JOB_RUNNER_SECRET is required");
  });

  it("rejects an unreviewed OpenAI image model before runtime dependencies are built", () => {
    expect(() => parseCustomerServiceConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "unapproved-image-model",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      META_ATTACHMENT_ALLOWED_HOSTS: "cdn.facebook.com",
      CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY: "source-encryption-secret-at-least-32-bytes",
      REPLY_ASSISTANT_JOB_RUNNER_SECRET: "job-runner-secret-at-least-32-bytes",
    })).toThrow("image_analysis_model_not_approved");
  });

  it("normalizes allowed attachment hosts", () => {
    const parsed = parseCustomerServiceConfig({
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "gpt-vision",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      META_ATTACHMENT_ALLOWED_HOSTS: " CDN.FACEBOOK.COM, fbcdn.net ",
      CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY: "source-encryption-secret-at-least-32-bytes",
      REPLY_ASSISTANT_JOB_RUNNER_SECRET: "job-runner-secret-at-least-32-bytes",
    });
    expect(parsed.metaAttachmentAllowedHosts).toEqual(["cdn.facebook.com", "fbcdn.net"]);
  });

  it.each([
    "http://example.test",
    "user:pass@example.test",
    "example.test:443",
    "example.test/path",
    "example.test?query=1",
    "example.test#fragment",
    "example .test",
    "example..test",
    "-example.test",
    "example-.test",
  ])("rejects invalid attachment hostname %s", (host) => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED: "true",
      OPENAI_IMAGE_ANALYSIS_MODEL: "gpt-vision",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      META_ATTACHMENT_ALLOWED_HOSTS: host,
    })).toThrow("META_ATTACHMENT_ALLOWED_HOSTS contains an invalid hostname");
  });
});
