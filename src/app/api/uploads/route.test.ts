import { describe, expect, it, vi } from "vitest";
import type { CheckoutRepository } from "@/server/checkout/checkout-repository";
import { CHECKOUT_SESSION_COOKIE_NAME } from "@/server/checkout/session-cookie";
import type { PrivateUploadReference } from "@/server/uploads/local-private-upload-store";
import { createUploadRoute } from "./route";

const origin = "https://shop.example.test";
const sessionId = "10000000-0000-4000-8000-000000000001";
const uploadId = "20000000-0000-4000-8000-000000000001";
const stored: PrivateUploadReference = {
  id: uploadId,
  originalName: "family.jpg",
  mimeType: "image/jpeg",
  size: 3,
  storageKey: `${uploadId}.bin`,
  sha256: "a".repeat(64),
};
const parsedFile = new File(["abc"], "family.jpg", { type: "image/jpeg" });

function request(requestOrigin = origin) {
  const boundary = "rnr-test-boundary";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="family.jpg"',
    "Content-Type: image/jpeg",
    "",
    "abc",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return new Request(`${origin}/api/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body,
  });
}

function repository(overrides: Partial<CheckoutRepository> = {}): CheckoutRepository {
  return {
    findActiveSessionByTokenDigest: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({
      id: sessionId,
      tokenDigest: "digest",
      customerId: null,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    bindGuestSessionToCustomer: vi.fn().mockResolvedValue(null),
    createUpload: vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date(),
    })),
    findOwnedUploadIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("POST /api/uploads", () => {
  it("creates a checkout session, persists upload ownership and sets a secure cookie", async () => {
    const repo = repository();
    const store = { save: vi.fn().mockResolvedValue(stored), remove: vi.fn() };
    const handler = createUploadRoute({
      repository: repo,
      store,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      createToken: () => "new-token",
      now: () => new Date("2026-08-02T00:00:00.000Z"),
      environment: "production",
      parseUpload: async () => parsedFile,
    });

    const response = await handler(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      reference: { id: uploadId, originalName: "family.jpg" },
    });
    expect(repo.createUpload).toHaveBeenCalledWith({
      id: uploadId,
      checkoutSessionId: sessionId,
      storageKey: `${uploadId}.bin`,
      originalName: "family.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 3,
      sha256: "a".repeat(64),
    });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`${CHECKOUT_SESSION_COOKIE_NAME}=new-token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
  });

  it("binds a new signed-in checkout session to the current customer", async () => {
    const repo = repository();
    const handler = createUploadRoute({
      repository: repo,
      store: { save: vi.fn().mockResolvedValue(stored), remove: vi.fn() },
      getOptionalSession: async () => ({ user: { id: "customer-a" } }),
      trustedOrigin: origin,
      createToken: () => "new-token",
      parseUpload: async () => parsedFile,
    });

    expect((await handler(request())).status).toBe(201);
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-a" }),
    );
  });

  it("removes just-written private files when database metadata insertion fails", async () => {
    const repo = repository({
      createUpload: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const store = { save: vi.fn().mockResolvedValue(stored), remove: vi.fn() };
    const handler = createUploadRoute({
      repository: repo,
      store,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      createToken: () => "new-token",
      parseUpload: async () => parsedFile,
    });

    expect((await handler(request())).status).toBe(500);
    expect(store.remove).toHaveBeenCalledWith(stored);
  });

  it("rejects cross-site multipart requests before creating a session or file", async () => {
    const repo = repository();
    const store = { save: vi.fn(), remove: vi.fn() };
    const handler = createUploadRoute({
      repository: repo,
      store,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      parseUpload: async () => parsedFile,
    });

    const response = await handler(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(repo.createSession).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
