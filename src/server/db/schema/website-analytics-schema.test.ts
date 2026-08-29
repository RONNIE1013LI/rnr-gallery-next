import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  websiteAnalyticsPageviews,
  websiteAnalyticsSessions,
} from "./index";

describe("website analytics schema contract", () => {
  it("defines only the approved two analytics tables", () => {
    expect([websiteAnalyticsSessions, websiteAnalyticsPageviews].map(getTableName)).toEqual([
      "website_analytics_sessions",
      "website_analytics_pageviews",
    ]);
  });

  it("stores privacy-minimised session attribution", () => {
    const columns = getTableColumns(websiteAnalyticsSessions);
    expect(columns).toEqual(expect.objectContaining({
      id: expect.anything(),
      visitorDigest: expect.anything(),
      startedAt: expect.anything(),
      localDate: expect.anything(),
      channel: expect.anything(),
      source: expect.anything(),
      medium: expect.anything(),
      utmCampaign: expect.anything(),
      clickIdType: expect.anything(),
      countryCode: expect.anything(),
    }));
    expect(columns.visitorDigest.dataType).toBe("string");
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "ip", "fullIp", "email", "name", "phone", "accountId", "userAgent",
      "gclid", "gbraid", "wbraid", "fbclid", "clickId",
    ]));
  });

  it("uses an idempotent pageview UUID and cascade session ownership", () => {
    const columns = getTableColumns(websiteAnalyticsPageviews);
    const config = getTableConfig(websiteAnalyticsPageviews);
    expect(columns).toEqual(expect.objectContaining({
      id: expect.anything(),
      sessionId: expect.anything(),
      occurredAt: expect.anything(),
      localDate: expect.anything(),
      pathname: expect.anything(),
    }));
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
  });

  it("contains only dashboard-query indexes and approved checks", () => {
    const sessionConfig = getTableConfig(websiteAnalyticsSessions);
    const pageviewConfig = getTableConfig(websiteAnalyticsPageviews);
    expect(sessionConfig.indexes.map((index) => index.config.name)).toEqual([
      "website_analytics_sessions_local_date_visitor_idx",
      "website_analytics_sessions_local_date_channel_idx",
      "website_analytics_sessions_started_id_idx",
    ]);
    expect(pageviewConfig.indexes.map((index) => index.config.name)).toEqual([
      "website_analytics_pageviews_session_idx",
      "website_analytics_pageviews_local_path_session_idx",
    ]);
    expect(sessionConfig.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "website_analytics_sessions_visitor_digest_valid",
      "website_analytics_sessions_channel_valid",
      "website_analytics_sessions_click_id_type_valid",
      "website_analytics_sessions_country_code_valid",
    ]));
    expect(pageviewConfig.checks.map((check) => check.name)).toContain(
      "website_analytics_pageviews_pathname_valid",
    );
  });

  it("uses the approved forward-only 0058 two-table migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0058_website_analytics_v1.sql"),
      "utf8",
    );
    expect(migration.match(/CREATE TABLE "website_analytics_/g)).toHaveLength(2);
    expect(migration).toContain('CREATE TABLE "website_analytics_sessions"');
    expect(migration).toContain('CREATE TABLE "website_analytics_pageviews"');
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).not.toMatch(/^\s*(?:DROP\b|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
    expect(migration).not.toMatch(/ALTER TABLE "(?!website_analytics_pageviews)/);
    expect(migration).not.toMatch(/\b(?:orders|payments|production_jobs|customer_service_)\b/i);
  });
});
