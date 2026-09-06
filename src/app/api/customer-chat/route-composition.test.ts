import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/customer-service/runtime", () => { throw Error("legacy runtime imported on shared chat path"); });
vi.mock("@/server/db/client", () => { throw Error("database imported on shared chat path"); });
vi.mock("@/server/db/schema", () => { throw Error("schema imported on shared chat path"); });
vi.mock("next/server", () => ({ after: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("WEBSITE_CUSTOMER_ASSISTANT_ENABLED", "true");
  vi.stubEnv("RNR_WEBSITE_SHARED_BRAIN_ENABLED", "true");
  vi.stubEnv("RNR_AI_ENABLED", "false");
  vi.stubEnv("CUSTOMER_CHAT_SESSION_SECRET", "s".repeat(40));
  vi.stubEnv("CUSTOMER_CHAT_ABUSE_HASH_SECRET", "a".repeat(40));
  vi.stubEnv("REPLY_ASSISTANT_REVIEW_LINK_SECRET", "r".repeat(40));
  vi.stubEnv("CRON_SECRET", "c".repeat(40));
  vi.stubEnv("BETTER_AUTH_SECRET", "b".repeat(40));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
}
describe("public shared route composition", () => {
  it("loads all public routes without importing database or legacy runtime", async () => {
    configure();
    for (const path of ["./session/route", "./messages/route", "./updates/route"]) {
      expect(await import(path)).toBeDefined();
    }
  });
});
