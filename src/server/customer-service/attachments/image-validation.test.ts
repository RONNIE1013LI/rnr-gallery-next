import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateImageAttachment } from "./image-validation";

async function image(
  format: "jpeg" | "png" | "webp",
  width = 2,
  height = 3,
) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 48, b: 72 },
    },
  })[format]().toBuffer();
}

describe("validateImageAttachment", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("accepts a valid %s image", async (format, mimeType) => {
    const bytes = await image(format);

    await expect(validateImageAttachment(bytes, mimeType)).resolves.toEqual({
      bytes,
      mimeType,
      width: 2,
      height: 3,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("rejects unsupported declared MIME types", async () => {
    await expect(validateImageAttachment(await image("png"), "image/gif"))
      .rejects.toThrow("Unsupported image type");
  });

  it("rejects bytes whose signature does not match the declared MIME type", async () => {
    await expect(validateImageAttachment(await image("png"), "image/jpeg"))
      .rejects.toThrow("Image signature does not match");
  });

  it("rejects malformed bytes with a supported signature", async () => {
    await expect(validateImageAttachment(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"))
      .rejects.toThrow("Invalid image");
  });

  it("rejects truncated pixel data even when metadata is readable", async () => {
    const complete = await image("png", 20, 20);
    const truncated = complete.subarray(0, complete.length - 20);

    await expect(sharp(truncated).metadata()).resolves.toMatchObject({
      width: 20,
      height: 20,
    });
    await expect(validateImageAttachment(truncated, "image/png"))
      .rejects.toThrow("Invalid image");
  });

  it("rejects images above the exact pixel limit", async () => {
    const bytes = await image("png", 5_000, 4_001);

    await expect(validateImageAttachment(bytes, "image/png"))
      .rejects.toThrow("Image dimensions exceed limits");
  });

  it("rejects an image with an 8193-pixel side", async () => {
    const bytes = await image("png", 8_193, 1);

    await expect(validateImageAttachment(bytes, "image/png"))
      .rejects.toThrow("Image dimensions exceed limits");
  });

  it("rejects animated images", async () => {
    const bytes = await sharp(
      Buffer.from([
        24, 48, 72, 255,
        72, 48, 24, 255,
      ]),
      {
        raw: {
          width: 1,
          height: 2,
          channels: 4,
          pageHeight: 1,
        },
      },
    )
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();

    await expect(validateImageAttachment(bytes, "image/webp"))
      .rejects.toThrow("Animated images are not supported");
  });
});
