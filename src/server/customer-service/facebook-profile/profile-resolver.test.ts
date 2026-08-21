import { describe, expect, it, vi } from "vitest";
import { createFacebookProfileResolver } from "./profile-resolver";

describe("Facebook profile resolver", () => {
  it("uses one fixed GET request and returns a sanitized first and last name", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      first_name: "  Tina\u0000 ",
      last_name: " Stuart  ",
    }), { status: 200 }));
    const resolver = createFacebookProfileResolver({
      token: "profile-only-secret",
      fetchImpl,
      timeoutMs: 500,
    });

    await expect(resolver.resolve("psid-123")).resolves.toEqual({
      status: "resolved",
      customerDisplayName: "Tina Stuart",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://graph.facebook.com/v23.0/psid-123?fields=first_name%2Clast_name");
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer profile-only-secret" },
    });
    expect(String(url)).not.toContain("profile-only-secret");
  });

  it("encodes the PSID as one path segment and never accepts a caller path or fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ first_name: "A", last_name: "B" })));
    const resolver = createFacebookProfileResolver({ token: "secret", fetchImpl, timeoutMs: 500 });

    await resolver.resolve("../messages?fields=id");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("..%2Fmessages%3Ffields%3Did?fields=first_name%2Clast_name");
    expect(init).toMatchObject({ method: "GET" });
    expect(init).not.toHaveProperty("body");
  });

  it.each([429, 500, 503])("classifies HTTP %s as a temporary failure", async (status) => {
    const resolver = createFacebookProfileResolver({
      token: "secret",
      fetchImpl: vi.fn(async () => new Response("unavailable", { status })),
      timeoutMs: 500,
    });
    await expect(resolver.resolve("psid")).resolves.toEqual({ status: "temporary_failure" });
  });

  it.each([400, 401, 403, 404])("classifies HTTP %s as unavailable", async (status) => {
    const resolver = createFacebookProfileResolver({
      token: "secret",
      fetchImpl: vi.fn(async () => new Response("denied", { status })),
      timeoutMs: 500,
    });
    await expect(resolver.resolve("psid")).resolves.toEqual({ status: "unavailable" });
  });

  it("fails unavailable when Meta returns no usable name", async () => {
    const resolver = createFacebookProfileResolver({
      token: "secret",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ first_name: "\u0000", last_name: " " }))),
      timeoutMs: 500,
    });
    await expect(resolver.resolve("psid")).resolves.toEqual({ status: "unavailable" });
  });

  it("fails temporarily on timeout without exposing the token", async () => {
    const fetchImpl = vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      return new Response();
    });
    const resolver = createFacebookProfileResolver({ token: "secret", fetchImpl, timeoutMs: 5 });
    await expect(resolver.resolve("psid")).resolves.toEqual({ status: "temporary_failure" });
  });
});
