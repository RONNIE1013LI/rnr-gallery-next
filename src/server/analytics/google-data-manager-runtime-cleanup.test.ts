import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const runtimeSources = () => readdirSync(resolve(process.cwd(), "src"), {
  recursive: true,
  encoding: "utf8",
}).filter((path) => /\.(?:ts|tsx)$/.test(path)
  && !/\.(?:integration\.)?test\.(?:ts|tsx)$/.test(path))
  .map((path) => {
    const projectPath = `src/${path.replace(/\\/g, "/")}`;
    return Object.freeze({ path: projectPath, source: projectFile(projectPath) });
  });

describe("Google Data Manager Phase 0C runtime cleanup", () => {
  it("keeps every non-test runtime module except the standalone client free from Data Manager wiring", () => {
    const standaloneClient = "src/server/analytics/google-data-manager-client.ts";
    const sources = runtimeSources();
    const adminRuntime = sources.find(({ path }) => path === "src/server/admin/admin-production-runtime.ts");

    expect(existsSync(resolve(process.cwd(), "src/server/analytics/google-ads-offline-client.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/server/analytics/google-ads-offline-client.test.ts"))).toBe(false);
    expect(sources.map(({ path }) => path)).toContain(standaloneClient);
    for (const { path, source } of sources) {
      expect(source, path).not.toMatch(/\buploadClickConversions\b/);
      expect(source, path).not.toMatch(/googleads\.googleapis\.com/);
      expect(source, path).not.toMatch(/developer-token/);
      expect(source, path).not.toMatch(/auth\/adwords/);
      expect(source, path).not.toMatch(/adUserData\s*:\s*["']GRANTED["']/);
      if (path === standaloneClient) {
        expect(source, path).toMatch(/validateOnly\s*:\s*false/);
        continue;
      }
      expect(source, path).not.toMatch(/google-data-manager-client/);
      expect(source, path).not.toMatch(/\b(?:createGoogleDataManagerClient|validateSynthetic)\b/);
      expect(source, path).not.toMatch(/validateOnly\s*:\s*false/);
    }

    expect(adminRuntime?.source).toBeDefined();
    expect(adminRuntime?.source).not.toMatch(
      /google-data-manager-client|\b(?:createGoogleDataManagerClient|validateSynthetic|fetch|getAccessToken)\b|GOOGLE_(?:DATA_MANAGER|ADS_OAUTH)_/,
    );
  });

  it("exposes no public Data Manager diagnostic route and documents disabled non-secret configuration", () => {
    const apiSources = runtimeSources()
      .filter(({ path }) => path.startsWith("src/app/api/"))
      .map(({ source }) => source)
      .join("\n");
    const envExample = projectFile(".env.example");

    expect(apiSources).not.toContain("data-manager");
    expect(apiSources).not.toContain("validateSynthetic");
    expect(envExample).toContain("GOOGLE_MANUAL_CONVERSIONS_ENABLED=false");
    expect(envExample).toContain("GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT=");
    expect(envExample).toContain("GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID=");
    expect(envExample).toContain("GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID=");
    expect(envExample).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN=");
    expect(envExample).not.toContain("GOOGLE_ADS_OAUTH_CLIENT_SECRET=");
    expect(envExample).not.toContain("GOOGLE_ADS_OAUTH_REFRESH_TOKEN=");
  });

  it("requires a protected immutable event snapshot and approved retention before activation", () => {
    const design = projectFile("docs/superpowers/specs/google-data-manager-delivery-outbox-design.md");

    expect(design).toContain("source_event_id");
    expect(design).toContain("prior_payment_status");
    expect(design).toContain("current_payment_status");
    expect(design).toContain("order_created_at");
    expect(design).toContain("manual_payment_confirmed_at");
    expect(design).toContain("encrypted_event_snapshot");
    expect(design).toContain("encryption_key_version");
    expect(design).toContain("application-layer encryption");
    expect(design).toContain("exact normalized click ID");
    expect(design).toContain("protected exact");
    expect(design).toContain("`transaction_id`");
    expect(design).toContain("`request_id`");
    expect(design).toMatch(/logs, operator displays, and unprotected\s+observability/i);
    expect(design).toMatch(/dead-letter review/i);
    expect(design).toContain("pre-migration activation gate");
  });
});
