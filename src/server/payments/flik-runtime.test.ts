import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ readiness: vi.fn(), database: vi.fn(), repository: vi.fn() }));
vi.mock("./flik-checkout-access", () => ({ canReconcileFlikPayments: mocks.readiness }));
vi.mock("@/server/db/client", () => ({ getDatabase: mocks.database }));
vi.mock("./flik-repository", () => ({ createDrizzleFlikRepository: mocks.repository }));
import { createFlikRuntime } from "./flik-runtime";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Flik runtime migration gate", () => {
  it("never initializes payment storage when config is valid but readiness is incomplete", async () => {
    for (const [key, value] of Object.entries({ ENABLE_FLIK_PAYMENTS: "true", FLIK_MODE: "live", VERCEL_ENV: "production", FLIK_CLIENT_ID: "flik_live_cid_fixture", FLIK_CLIENT_SECRET: "flik_live_sk_fixture", FLIK_WEBHOOK_SECRET: "whsec_fixture", PAYMENT_RETURN_BASE_URL: "https://rnrgallery.com" })) vi.stubEnv(key, value);
    mocks.readiness.mockResolvedValue(false);
    expect(await createFlikRuntime()).toBeNull();
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.repository).not.toHaveBeenCalled();
  });
});
