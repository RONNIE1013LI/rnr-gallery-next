import { describe, expect, it } from "vitest";
import {
  assertAutomationTarget,
  AUTOMATION_CAPABILITY_STORAGE_KEY,
  AUTOMATION_SESSION_STORAGE_KEY,
  buildProductionSmokeUrl,
  OFFICIAL_PRODUCTION_HOSTS,
  resolveGuardStatus,
  resolveProductionTtlSeconds,
  shouldBlockProductionResource,
  type ProductionCapability,
} from "./production-access-guard";

const now = new Date("2026-08-31T00:00:00.000Z");
const on = { state: "ON" } as const;

describe("central automation access policy", () => {
  it("rejects Production presented as Preview with the approved workflow message", () => {
    expect(() => assertAutomationTarget({
      rawUrl: "https://rnrgallery.com/",
      targetMode: "PREVIEW",
      guardStatus: on,
    })).toThrow(/PRODUCTION_AUTOMATION_BLOCKED[\s\S]*Use approved Production Smoke workflow/);
  });

  it.each([
    ["local", "http://localhost:3000/shop", "LOCAL" as const],
    ["loopback", "https://127.0.0.1:3010/", "LOCAL" as const],
    ["preview", "https://rnr-next-platform-git-guard-test.vercel.app/", "PREVIEW" as const],
  ])("accepts an approved %s target", (_label, rawUrl, targetMode) => {
    expect(assertAutomationTarget({ rawUrl, targetMode, guardStatus: on }).toString()).toBe(rawUrl);
  });

  it("rejects an unknown target", () => {
    expect(() => assertAutomationTarget({
      rawUrl: "https://example.com/",
      targetMode: "PREVIEW",
      guardStatus: on,
    })).toThrow("AUTOMATION_TARGET_BLOCKED");
  });

  it("requires explicit authorization for Production Smoke", () => {
    expect(() => assertAutomationTarget({
      rawUrl: "https://rnrgallery.com/",
      targetMode: "PRODUCTION_SMOKE",
      guardStatus: on,
    })).toThrow("PRODUCTION_AUTOMATION_BLOCKED");
  });

  it.each(OFFICIAL_PRODUCTION_HOSTS)("accepts authorized Production Smoke on %s", (host) => {
    expect(assertAutomationTarget({
      rawUrl: `https://${host}/shop`,
      targetMode: "PRODUCTION_SMOKE",
      guardStatus: on,
      productionSmokeAuthorized: true,
    }).hostname).toBe(host);
  });

  it("rejects credentials and invalid protocol for non-local targets", () => {
    expect(() => assertAutomationTarget({
      rawUrl: "https://user:password@rnr-next-platform-git-guard-test.vercel.app/",
      targetMode: "PREVIEW",
      guardStatus: on,
    })).toThrow("AUTOMATION_TARGET_BLOCKED");
    expect(() => assertAutomationTarget({
      rawUrl: "http://rnr-next-platform-git-guard-test.vercel.app/",
      targetMode: "PREVIEW",
      guardStatus: on,
    })).toThrow("AUTOMATION_TARGET_BLOCKED");
  });

  it("requires ATTRIBUTION for attribution query parameters and preserves them", () => {
    const rawUrl = "https://rnrgallery.com/shop?UTM_Source=google&gClId=click-1";
    expect(() => buildProductionSmokeUrl({
      rawUrl,
      capability: "DEFAULT",
      guardStatus: on,
      productionSmokeAuthorized: true,
    })).toThrow("AUTOMATION_ATTRIBUTION_CAPABILITY_REQUIRED");
    expect(buildProductionSmokeUrl({
      rawUrl,
      capability: "ATTRIBUTION",
      guardStatus: on,
      productionSmokeAuthorized: true,
    }).toString()).toBe(rawUrl);
  });

  it.each(["image", "media", "font"]) ("DEFAULT blocks %s resources", (resourceType) => {
    expect(shouldBlockProductionResource(resourceType, "DEFAULT", false)).toBe(true);
  });

  it.each(["document", "script", "stylesheet", "fetch", "xhr"]) ("DEFAULT allows %s resources", (resourceType) => {
    expect(shouldBlockProductionResource(resourceType, "DEFAULT", false)).toBe(false);
  });

  it("allows VISUAL image and font resources but requires allowMedia for media", () => {
    expect(shouldBlockProductionResource("image", "VISUAL", false)).toBe(false);
    expect(shouldBlockProductionResource("font", "VISUAL", false)).toBe(false);
    expect(shouldBlockProductionResource("media", "VISUAL", false)).toBe(true);
    expect(shouldBlockProductionResource("media", "VISUAL", true)).toBe(false);
  });

  it.each([
    "DEFAULT",
    "VISUAL",
    "ATTRIBUTION",
    "REPLY_ASSISTANT_TEST",
  ] as ProductionCapability[]) ("uses the standard TTL for %s", (capability) => {
    expect(resolveProductionTtlSeconds(capability)).toBe(120);
  });

  it.each([121, 600])("accepts EXTENDED TTL %s seconds", (requested) => {
    expect(resolveProductionTtlSeconds("EXTENDED", requested)).toBe(requested);
  });

  it.each([120, 601, undefined, 121.5, Number.POSITIVE_INFINITY])(
    "rejects invalid EXTENDED TTL %s",
    (requested) => {
      expect(() => resolveProductionTtlSeconds("EXTENDED", requested)).toThrow("AUTOMATION_TTL_BLOCKED");
    },
  );

  it("resolves a fully authorized bounded temporary grant", () => {
    const env = {
      RNR_PRODUCTION_GUARD_TEMP_BYPASS: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER: "admin",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON: "approved smoke diagnosis",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: now.toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT: new Date(now.getTime() + 600_000).toISOString(),
    };
    expect(resolveGuardStatus(env, now)).toEqual({
      state: "TEMP_BYPASS",
      owner: "admin",
      reason: "approved smoke diagnosis",
      startedAt: now,
      expiresAt: new Date(now.getTime() + 600_000),
    });
  });

  it.each([
    ["missing authorization", { RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED: undefined }],
    ["missing bypass flag", { RNR_PRODUCTION_GUARD_TEMP_BYPASS: undefined }],
    ["empty owner", { RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER: "  " }],
    ["empty reason", { RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON: "  " }],
    ["future start", { RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: new Date(now.getTime() + 1).toISOString() }],
    ["expiry before start", {
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: now.toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT: now.toISOString(),
    }],
    ["expiry beyond six hundred seconds", {
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: now.toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT: new Date(now.getTime() + 600_001).toISOString(),
    }],
  ])("fails closed for a temporary grant with %s", (_label, partial) => {
    expect(resolveGuardStatus({
      RNR_PRODUCTION_GUARD_TEMP_BYPASS: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER: "admin",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON: "reason",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: now.toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT: new Date(now.getTime() + 120_000).toISOString(),
      ...partial,
    }, now)).toEqual(on);
  });

  it("returns ON after expiry and never returns OFF or a permanent state", () => {
    const env = {
      RNR_PRODUCTION_GUARD_TEMP_BYPASS: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED: "1",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER: "admin",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON: "reason",
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT: new Date(now.getTime() - 1_000).toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT: now.toISOString(),
      RNR_PRODUCTION_GUARD_TEMP_BYPASS_STATE: "OFF",
    };
    const status = resolveGuardStatus(env, now);
    expect(status).toEqual(on);
    expect(status).not.toMatchObject({ state: "OFF" });
    expect(status).not.toMatchObject({ permanent: true });
  });

  it("allows a valid temporary grant only for official Production hosts", () => {
    const guardStatus = {
      state: "TEMP_BYPASS" as const,
      owner: "admin",
      reason: "reason",
      startedAt: new Date(now.getTime() - 1_000),
      expiresAt: new Date(now.getTime() + 599_000),
    };
    for (const host of OFFICIAL_PRODUCTION_HOSTS) {
      expect(assertAutomationTarget({
        rawUrl: `https://${host}/`,
        targetMode: "PREVIEW",
        guardStatus,
      }).hostname).toBe(host);
    }
    expect(() => assertAutomationTarget({
      rawUrl: "https://example.com/",
      targetMode: "PREVIEW",
      guardStatus,
    })).toThrow("AUTOMATION_TARGET_BLOCKED");
  });

  it("exports stable session storage keys", () => {
    expect(AUTOMATION_SESSION_STORAGE_KEY).toBe("rnr_automation");
    expect(AUTOMATION_CAPABILITY_STORAGE_KEY).toBe("rnr_automation_capability");
  });
});
