import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalNotificationRecipientValidationError } from "@/server/notifications/internal-notification-recipient-service";
import { createPublicNotificationEmailVerificationRoute } from "./route-handler";
import * as publicRoute from "./route";

const { runtimeGetter } = vi.hoisted(() => ({ runtimeGetter: vi.fn() }));

vi.mock("@/server/notifications/internal-notification-recipient-runtime", () => ({
  getInternalNotificationRecipientRuntime: runtimeGetter,
}));
vi.mock("@/server/auth/config", () => ({
  parseAuthConfig: () => ({
    origin: "http://localhost:3000",
    baseURL: "http://localhost:3000",
    secret: "test-only",
  }),
}));

const origin = "http://localhost:3000";
const rawToken = "a".repeat(43);
const context = { params: Promise.resolve({ token: rawToken }) };
const invalid = { error: "This verification link is invalid or expired." };

function request(requestOrigin = origin) {
  return new Request(`${origin}/api/notification-email/verify/${rawToken}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
  });
}

describe("public notification email verification route", () => {
  beforeEach(() => {
    runtimeGetter.mockReset();
  });

  it("does not expose a GET handler that could consume scanner requests", () => {
    expect("GET" in publicRoute).toBe(false);
  });

  it("consumes only the opaque path token without an Admin session", async () => {
    const verify = vi.fn().mockResolvedValue({ id: "recipient-secret", email: "ops@example.test" });
    const route = createPublicNotificationEmailVerificationRoute({ verify, trustedOrigin: origin });

    const response = await route.POST(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(verify).toHaveBeenCalledWith(rawToken);
    await expect(response.json()).resolves.toEqual({ result: "verified" });
  });

  it.each([
    ["unknown", null],
    ["expired", null],
    ["replayed", null],
    ["malformed", new InternalNotificationRecipientValidationError("private token detail")],
  ])("returns the same safe invalid response for %s tokens", async (_kind, outcome) => {
    const verify = outcome instanceof Error
      ? vi.fn().mockRejectedValue(outcome)
      : vi.fn().mockResolvedValue(outcome);
    const route = createPublicNotificationEmailVerificationRoute({ verify, trustedOrigin: origin });

    const response = await route.POST(request(), context);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(invalid);
  });

  it("requires a same-site trusted origin before token consumption", async () => {
    const verify = vi.fn();
    const route = createPublicNotificationEmailVerificationRoute({ verify, trustedOrigin: origin });

    const response = await route.POST(request("https://attacker.example"), context);

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "The request origin is not allowed" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("does not initialize the default runtime for a cross-origin request", async () => {
    const route = createPublicNotificationEmailVerificationRoute();

    const response = await route.POST(request("https://attacker.example"), context);

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runtimeGetter).not.toHaveBeenCalled();
  });

  it("maps default runtime initialization failures to a no-store 500", async () => {
    runtimeGetter.mockImplementation(() => {
      throw new Error("private runtime configuration failure");
    });

    const response = await createPublicNotificationEmailVerificationRoute().POST(
      request(),
      context,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Email verification could not be completed.",
    });
  });

  it("returns a bounded 500 without recipient, token, or service details", async () => {
    const route = createPublicNotificationEmailVerificationRoute({
      verify: vi.fn().mockRejectedValue(new Error(`database failure ${rawToken} ops@example.test`)),
      trustedOrigin: origin,
    });

    const response = await route.POST(request(), context);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ error: "Email verification could not be completed." });
    expect(JSON.stringify(body)).not.toContain(rawToken);
    expect(JSON.stringify(body)).not.toContain("ops@example.test");
  });
});
