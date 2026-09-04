import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAttachmentSourceProtector } from "@/server/customer-service/attachments/attachment-source-protector";
import type { AttachmentSourceReader } from "@/server/customer-service/attachments/image-validation";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import { createMetaImageResolver, MetaImageResolutionError } from "./image-resolver";
import type { MetaConversationEvent } from "./types";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function event(): MetaConversationEvent {
  return {
    channel: "facebook",
    role: "customer",
    eventType: "customer_message",
    externalConversationKey: "customer-raw",
    externalMessageKey: "message-raw",
    externalReplyToMessageKey: null,
    text: "Can you use this?",
    attachments: [{
      externalAttachmentKey: "attachment-raw",
      ordinal: 0,
      kind: "image",
      sourceRef: { kind: "facebook_remote", url: "https://scontent.test/private.jpg" },
      mimeTypeHint: null,
      failureCode: null,
    }],
    receivedAt: new Date("2026-09-04T00:00:00Z"),
  };
}

function setup(reader?: AttachmentSourceReader) {
  const now = new Date("2026-09-04T00:00:00Z");
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  const put = vi.spyOn(store, "putEphemeralSecret");
  const remove = vi.spyOn(store, "deleteEphemeralSecret");
  const sourceReader: AttachmentSourceReader = reader ?? {
    channel: "facebook",
    read: vi.fn(async () => ({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg" as const,
      width: 10,
      height: 10,
      sha256: "a".repeat(64),
    })),
  };
  const resolver = createMetaImageResolver({
    store,
    sourceProtector: createAttachmentSourceProtector("source-secret-that-is-at-least-32-characters", {
      now: () => now,
      randomBytes: () => Buffer.alloc(12, 1),
    }),
    sourceReader,
    hashExternalKey: hash,
    now: () => now,
    timeoutSignal: () => new AbortController().signal,
  });
  return { resolver, store, put, remove, sourceReader };
}

describe("Meta image resolver", () => {
  it("stores only encrypted source data for 15 minutes and returns validated in-memory bytes", async () => {
    const current = setup();
    await expect(current.resolver.resolveMetaImages(event())).resolves.toEqual([{
      ordinal: 0,
      mediaType: "image/jpeg",
      bytes: Buffer.from([1, 2, 3]),
      sha256: "a".repeat(64),
      width: 10,
      height: 10,
    }]);
    expect(current.put).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^v1\./), 900);
    expect(current.put.mock.calls[0][1]).not.toContain("private.jpg");
    expect(current.remove).toHaveBeenCalledTimes(1);
  });

  it("deletes the encrypted source and requires human review after any image failure", async () => {
    const sourceReader: AttachmentSourceReader = {
      channel: "facebook",
      read: vi.fn(async () => { throw new Error("unsafe image"); }),
    };
    const current = setup(sourceReader);
    await expect(current.resolver.resolveMetaImages(event())).rejects.toBeInstanceOf(MetaImageResolutionError);
    expect(current.remove).toHaveBeenCalledTimes(1);
  });

  it("fails before downloading unsupported or overflow attachments", async () => {
    const current = setup();
    const invalid = { ...event(), attachments: [{ ...event().attachments[0], kind: "unsupported" as const, sourceRef: null, failureCode: "too_many_attachments" }] };
    await expect(current.resolver.resolveMetaImages(invalid)).rejects.toMatchObject({ code: "image_review_required" });
    expect(current.sourceReader.read).not.toHaveBeenCalled();
  });

  it("contains no Blob, Neon or database write path", () => {
    const source = readFileSync(resolve("src/server/rnr-ai/meta/image-resolver.ts"), "utf8");
    expect(source).not.toMatch(/@vercel\/blob|getDatabase|drizzle|customer_service_|\.insert\(|\.update\(/i);
  });
});
