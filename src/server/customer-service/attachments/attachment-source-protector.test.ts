import { describe, expect, it } from "vitest";
import { createAttachmentSourceProtector } from "./attachment-source-protector";

const source = {
  ordinal: 0,
  externalAttachmentKeyHash: "a".repeat(64),
  sourceRef: { kind: "facebook_remote" as const, url: "https://scontent.test/private.jpg?token=secret" },
};

describe("customer service attachment source protector", () => {
  it("round-trips an expiring source without exposing the URL or attachment hash", () => {
    const protector = createAttachmentSourceProtector("k".repeat(32), {
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 7),
    });
    const expiresAt = new Date("2026-08-17T00:15:00.000Z");

    const ciphertext = protector.seal({ jobId: "job-1", sources: [source], expiresAt });

    expect(ciphertext).not.toContain("scontent.test");
    expect(ciphertext).not.toContain(source.externalAttachmentKeyHash);
    expect(protector.open({ jobId: "job-1", ciphertext, expiresAt })).toEqual([source]);
  });

  it("binds ciphertext to one job and fails closed after expiry without leaking source data", () => {
    let now = new Date("2026-08-17T00:00:00.000Z");
    const protector = createAttachmentSourceProtector("k".repeat(32), { now: () => now });
    const expiresAt = new Date("2026-08-17T00:15:00.000Z");
    const ciphertext = protector.seal({ jobId: "job-1", sources: [source], expiresAt });

    expect(() => protector.open({ jobId: "job-2", ciphertext, expiresAt }))
      .toThrow("customer_service_attachment_source_invalid");
    now = new Date("2026-08-17T00:15:00.001Z");
    expect(() => protector.open({ jobId: "job-1", ciphertext, expiresAt }))
      .toThrow("customer_service_attachment_source_expired");
  });
});
