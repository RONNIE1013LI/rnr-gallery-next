import { describe, expect, it } from "vitest";
import { createAccountThrottle } from "./account-throttle";

const secret = "test-only-account-throttle-secret-32-characters";
function fixture() {
  const buckets = new Map<string, number>();
  const throttle = createAccountThrottle({
    secret,
    async consume(key) {
      const attempts = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, attempts);
      return attempts;
    },
  });
  return { throttle, buckets };
}

describe("account authentication throttle", () => {
  it("limits attempts for the same normalized account regardless of the client IP", async () => {
    const { throttle } = fixture();
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(await throttle("/sign-in/email", { email: " Staff@Example.test " })).toBe(true);
    }
    expect(await throttle("/sign-in/email", { email: "staff@example.test" })).toBe(false);
    expect(await throttle("/sign-in/email", { email: "another@example.test" })).toBe(true);
  });

  it("does not store email, password, or raw request data in rate-limit keys", async () => {
    const { throttle, buckets } = fixture();
    await throttle("/sign-in/email", { email: "staff@example.test", password: "must-not-be-stored" });
    expect([...buckets.keys()]).toHaveLength(1);
    expect([...buckets.keys()][0]).toMatch(/^rnr:auth-account:v1:[a-f0-9]{64}$/);
  });

  it("keeps password-reset and login limits separate", async () => {
    const { throttle } = fixture();
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await throttle("/request-password-reset", { email: "staff@example.test" })).toBe(true);
    }
    expect(await throttle("/request-password-reset", { email: "staff@example.test" })).toBe(false);
    expect(await throttle("/sign-in/email", { email: "staff@example.test" })).toBe(true);
  });

  it("does not throttle ordinary session reads or public commerce routes", async () => {
    const { throttle, buckets } = fixture();
    expect(await throttle("/get-session", {})).toBe(true);
    expect(await throttle("/checkout", { email: "customer@example.test" })).toBe(true);
    expect(buckets.size).toBe(0);
  });

  it("uses a finite 15-minute window and fails closed when shared storage fails", async () => {
    const windows: number[] = [];
    const throttle = createAccountThrottle({ secret, consume: async (_key, seconds) => {
      windows.push(seconds);
      throw new Error("storage unavailable");
    } });
    await expect(throttle("/sign-in/email", { email: "staff@example.test" })).rejects.toThrow();
    expect(windows).toEqual([900]);
  });
});
