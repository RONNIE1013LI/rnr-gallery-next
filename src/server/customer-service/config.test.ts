import { describe, expect, it } from "vitest";
import { parseCustomerServiceConfig, publicCustomerServiceConfig } from "./config";

describe("customer service server config", () => {
  it("keeps website customer chat disabled by default", () => {
    expect(parseCustomerServiceConfig({})).toMatchObject({
      enabled: false,
      websiteEnabled: false,
    });
  });

  it("enables website chat without requiring Meta credentials", () => {
    expect(parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    })).toMatchObject({
      enabled: false,
      websiteEnabled: true,
      replyAssistantAlertTo: "support@example.test",
    });
  });

  it("requires website-only session and abuse secrets when website chat is enabled", () => {
    const base = {
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    };
    expect(() => parseCustomerServiceConfig(base)).toThrow("CUSTOMER_CHAT_SESSION_SECRET is required");
    expect(() => parseCustomerServiceConfig({
      ...base,
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
    })).toThrow("CUSTOMER_CHAT_ABUSE_HASH_SECRET is required");
  });

  it("requires the staff alert recipient when website chat is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    })).toThrow("REPLY_ASSISTANT_ALERT_TO is required");
  });

  it("accepts only one bounded server-side staff alert email", () => {
    const base = {
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    };
    expect(() => parseCustomerServiceConfig({ ...base, REPLY_ASSISTANT_ALERT_TO: "not-an-email" }))
      .toThrow("REPLY_ASSISTANT_ALERT_TO must be a valid email address");
    expect(() => parseCustomerServiceConfig({ ...base, REPLY_ASSISTANT_ALERT_TO: `${"a".repeat(250)}@example.test` }))
      .toThrow("REPLY_ASSISTANT_ALERT_TO must be a valid email address");
  });

  it("requires a recovery secret when website chat is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
    })).toThrow("CRON_SECRET is required");
  });

  it("uses bounded website budget defaults", () => {
    const parsed = parseCustomerServiceConfig({});
    expect(parsed).toMatchObject({
      websiteDailyWarningMicrousd: 100_000,
      websiteDailyHardStopMicrousd: 250_000,
      websiteTotalHardStopMicrousd: 2_000_000,
    });
    expect(() => parseCustomerServiceConfig({ WEBSITE_CHAT_DAILY_HARD_STOP_USD: "0" }))
      .not.toThrow();
    expect(() => parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
      WEBSITE_CHAT_DAILY_HARD_STOP_USD: "0",
    })).toThrow("WEBSITE_CHAT_DAILY_HARD_STOP_USD must be positive");
  });

  it("rejects unsafe or contradictory website budgets", () => {
    const base = {
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    };
    expect(() => parseCustomerServiceConfig({ ...base, WEBSITE_CHAT_DAILY_HARD_STOP_USD: "1e308" }))
      .toThrow("WEBSITE_CHAT_DAILY_HARD_STOP_USD is too large");
    expect(() => parseCustomerServiceConfig({
      ...base,
      WEBSITE_CHAT_DAILY_WARNING_USD: "2",
      WEBSITE_CHAT_DAILY_HARD_STOP_USD: "1",
    })).toThrow("WEBSITE_CHAT_DAILY_WARNING_USD must be below WEBSITE_CHAT_DAILY_HARD_STOP_USD");
    expect(() => parseCustomerServiceConfig({
      ...base,
      WEBSITE_CHAT_DAILY_HARD_STOP_USD: "3",
      WEBSITE_CHAT_TOTAL_HARD_STOP_USD: "2",
    })).toThrow("WEBSITE_CHAT_TOTAL_HARD_STOP_USD must be at least WEBSITE_CHAT_DAILY_HARD_STOP_USD");
  });

  it("requires separate website session and abuse secret domains", () => {
    expect(() => parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "shared-website-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "shared-website-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    })).toThrow("CUSTOMER_CHAT_SESSION_SECRET and CUSTOMER_CHAT_ABUSE_HASH_SECRET must differ");
  });

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
      CRON_SECRET: "recovery-secret-at-least-32-bytes",
    });
    expect(JSON.stringify(publicCustomerServiceConfig(parsed))).not.toMatch(/meta-secret|verify-secret|hash-secret|OPENAI|image|blob|attachment/i);
  });

  it("public config exposes website availability but no website credentials", () => {
    const parsed = parseCustomerServiceConfig({
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true",
      CUSTOMER_CHAT_SESSION_SECRET: "website-session-secret-at-least-32-bytes",
      CUSTOMER_CHAT_ABUSE_HASH_SECRET: "website-abuse-secret-at-least-32-bytes",
      REPLY_ASSISTANT_ALERT_TO: "support@example.test",
      CRON_SECRET: "website-recovery-secret-at-least-32-bytes",
    });
    expect(publicCustomerServiceConfig(parsed)).toMatchObject({ websiteEnabled: true });
    expect(JSON.stringify(publicCustomerServiceConfig(parsed))).not.toMatch(/session-secret|abuse-secret|support@example|budget/i);
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

  it("bounds the server-side human reply grouping window", () => {
    expect(parseCustomerServiceConfig({}).humanReplyGroupMs).toBe(90_000);
    expect(parseCustomerServiceConfig({ REPLY_ASSISTANT_HUMAN_REPLY_GROUP_MS: "45000" }).humanReplyGroupMs).toBe(45_000);
    expect(() => parseCustomerServiceConfig({ REPLY_ASSISTANT_HUMAN_REPLY_GROUP_MS: "9999" }))
      .toThrow("REPLY_ASSISTANT_HUMAN_REPLY_GROUP_MS must be between 10000 and 120000");
  });

  it("requires a server-only recovery secret whenever the assistant is enabled", () => {
    expect(() => parseCustomerServiceConfig({
      REPLY_ASSISTANT_ENABLED: "true",
      META_APP_SECRET: "meta-secret",
      META_VERIFY_TOKEN: "verify-secret",
      META_PAGE_ID: "page-1",
      CUSTOMER_SERVICE_ID_HASH_SECRET: "hash-secret-long-enough",
    })).toThrow("CRON_SECRET is required");
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
