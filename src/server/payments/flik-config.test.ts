import { describe, expect, it } from "vitest";
import { parseFlikConfig } from "./flik-config";

const env = {
  ENABLE_FLIK_PAYMENTS: "true", FLIK_MODE: "test", VERCEL_ENV: "development",
  FLIK_CLIENT_ID: "flik_test_cid_fixture", FLIK_CLIENT_SECRET: "flik_test_sk_fixture",
  FLIK_WEBHOOK_SECRET: "whsec_fixture", DATABASE_URL: "postgresql://localhost/rnr_gallery_test_flik",
};
describe("Flik configuration isolation", () => {
  it("defaults to disabled without breaking other providers", () => {
    expect(parseFlikConfig({})).toEqual({ enabled: false });
  });
  it("accepts explicit nonproduction test configuration", () => {
    expect(parseFlikConfig(env)).toMatchObject({ enabled: true, mode: "test", testMode: true, deployment: "development" });
  });
  it.each([
    { FLIK_CLIENT_SECRET: undefined }, { FLIK_WEBHOOK_SECRET: "bad" }, { FLIK_MODE: undefined },
    { FLIK_CLIENT_ID: "flik_live_cid_fixture" }, { FLIK_CLIENT_SECRET: "flik_live_sk_fixture" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: undefined, NODE_ENV: "production" },
    { VERCEL_ENV: "unexpected" }, { ENABLE_FLIK_PAYMENTS: "false" },
  ])("fails closed for invalid config %o", (change) => {
    expect(parseFlikConfig({ ...env, ...change })).toEqual({ enabled: false });
  });
  it("only permits live credentials in explicit production deployment", () => {
    const live = { ...env, FLIK_MODE: "live", FLIK_CLIENT_ID: "flik_live_cid_fixture", FLIK_CLIENT_SECRET: "flik_live_sk_fixture" };
    expect(parseFlikConfig(live)).toEqual({ enabled: false });
    expect(parseFlikConfig({ ...live, VERCEL_ENV: undefined, FLIK_DEPLOYMENT_ENV: "production" })).toEqual({ enabled: false });
    expect(parseFlikConfig({ ...live, VERCEL_ENV: "production" })).toMatchObject({ enabled: true, testMode: false });
  });
  it("requires an explicit local deployment independently of NODE_ENV", () => {
    expect(parseFlikConfig({ ...env, VERCEL_ENV: undefined, NODE_ENV: "test" })).toEqual({ enabled: false });
    expect(parseFlikConfig({ ...env, VERCEL_ENV: undefined, FLIK_DEPLOYMENT_ENV: "development", NODE_ENV: "production" })).toMatchObject({ enabled: true, deployment: "development" });
  });
  it.each([undefined, "postgresql://prod.neon.tech/rnr_gallery_test_flik", "postgresql://localhost/rnr_gallery", "postgresql://localhost/rnr_gallery_test_flik?host=prod.neon.tech", "postgresql://localhost/rnr_gallery_test_flik?hostaddr=8.8.8.8", "postgresql://localhost/rnr_gallery_test_flik?service=prod"])("requires a local isolated test database %s", (DATABASE_URL) => {
    expect(parseFlikConfig({ ...env, DATABASE_URL })).toEqual({ enabled: false });
  });
  it("does not assume preview database isolation", () => {
    expect(parseFlikConfig({ ...env, VERCEL_ENV: "preview" })).toEqual({ enabled: false });
  });
});
