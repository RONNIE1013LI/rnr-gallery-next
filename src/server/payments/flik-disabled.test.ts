// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blocked = vi.hoisted(() => ({
  database: vi.fn(() => { throw new Error("Disabled Flik must not open the database"); }),
  repository: vi.fn(() => { throw new Error("Disabled Flik must not access its unmigrated tables"); }),
  adminPermission: vi.fn(async () => ({ user: { id: "admin-fixture" } })),
}));
vi.mock("@/server/db/client", () => ({ getDatabase: blocked.database }));
vi.mock("./flik-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./flik-repository")>(),
  createDrizzleFlikRepository: blocked.repository,
}));
vi.mock("@/server/auth/require-admin", () => ({ requireAdminPermission: blocked.adminPermission }));

import { parsePaymentConfig } from "./config";
import { createFlikRuntime } from "./flik-runtime";
import { selectPaymentProviders } from "./provider-registry";
import { POST as flikWebhook } from "@/app/api/payments/webhooks/flik/route-handler";
import { GET as flikReconciliation } from "@/app/api/internal/payments/flik/reconcile/route-handler";
import { POST as adminTestPayment } from "@/app/api/admin/payments/flik-test/route-handler";

const origin = "https://rnrgallery.com";
const production = {
  NODE_ENV: "production", VERCEL_ENV: "production",
  PAYMENT_RETURN_BASE_URL: origin,
  ENABLE_LOCAL_TEST_PAYMENTS: "false",
  STRIPE_SECRET_KEY: "sk_live_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  AFTERPAY_MERCHANT_ID: "fixture-merchant", AFTERPAY_SECRET_KEY: "fixture-secret", AFTERPAY_ENVIRONMENT: "production", AFTERPAY_MERCHANT_COUNTRY: "NZ",
  BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "disabled-flik-regression-only-0123456789ABCDEFG",
  CRON_SECRET: "fixture-cron-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(production)) vi.stubEnv(name, value);
  for (const name of ["ENABLE_FLIK_PAYMENTS", "FLIK_MODE", "FLIK_CLIENT_ID", "FLIK_CLIENT_SECRET", "FLIK_WEBHOOK_SECRET"]) vi.stubEnv(name, undefined);
});
afterEach(() => {
  expect(blocked.database).not.toHaveBeenCalled();
  expect(blocked.repository).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

describe.each(["default-off", "explicit-off-with-credentials"])("unmigrated Flik deployment: %s", (mode) => {
  beforeEach(() => {
    if (mode === "explicit-off-with-credentials") {
      vi.stubEnv("ENABLE_FLIK_PAYMENTS", "false");
      vi.stubEnv("FLIK_MODE", "live");
      vi.stubEnv("FLIK_CLIENT_ID", "flik_live_cid_fixture");
      vi.stubEnv("FLIK_CLIENT_SECRET", "flik_live_sk_fixture");
      vi.stubEnv("FLIK_WEBHOOK_SECRET", "whsec_fixture");
    }
  });

  it("parses actual production config as disabled and never initializes Flik persistence", () => {
    expect(parsePaymentConfig().flik).toEqual({ enabled: false });
    expect(createFlikRuntime()).toBeNull();
  });

  it("retains the actual Stripe and Afterpay adapters without registering Flik in Checkout", () => {
    const providers = selectPaymentProviders(parsePaymentConfig());
    expect(providers.map(({ method, provider, isTest }) => ({ method, key: provider.key, isTest }))).toEqual([
      { method: "card", key: "stripe", isTest: false },
      { method: "afterpay", key: "afterpay", isTest: false },
    ]);
  });

  it("returns 404 from the real default webhook branch without accessing new tables", async () => {
    const response = await flikWebhook(new Request(`${origin}/api/payments/webhooks/flik`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Flik is unavailable" });
  });

  it("returns disabled from the real scheduled worker with valid cron authentication", async () => {
    const response = await flikReconciliation(new Request(`${origin}/api/internal/payments/flik/reconcile`, {
      headers: { authorization: "Bearer fixture-cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ disabled: true });
  });

  it("rejects the real admin-test default runtime after permission and origin checks", async () => {
    const response = await adminTestPayment(new Request(`${origin}/api/admin/payments/flik-test`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", idempotencyKey: "10000000-0000-4000-8000-000000000001" }),
    }));
    expect(blocked.adminPermission).toHaveBeenCalledWith("manage_payment");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Isolated Flik testing is unavailable" });
  });
});
