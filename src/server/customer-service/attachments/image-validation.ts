import { createHash } from "node:crypto";
import sharp from "sharp";
import { IMAGE_LIMITS } from "./limits";
import type { AttachmentSourceRef } from "./types";

export type ResolvedAttachment = Readonly<{
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sha256: string;
}>;

export interface AttachmentSourceReader {
  readonly channel: "facebook" | "website";
  read(source: AttachmentSourceRef, signal: AbortSignal): Promise<ResolvedAttachment>;
}

type SupportedMimeType = ResolvedAttachment["mimeType"];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function declaredMimeType(value: string): SupportedMimeType {
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
    return normalized;
  }
  throw new Error("Unsupported image type");
}

function signatureMimeType(bytes: Buffer): SupportedMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function validateImageAttachment(
  bytes: Buffer,
  contentType: string,
): Promise<ResolvedAttachment> {
  const mimeType = declaredMimeType(contentType);
  if (signatureMimeType(bytes) !== mimeType) {
    throw new Error("Image signature does not match declared type");
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: IMAGE_LIMITS.maxPixels,
    }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new Error("Image dimensions exceed limits");
    }
    throw new Error("Invalid image");
  }

  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Invalid image");
  if ((metadata.pages ?? 1) > 1) throw new Error("Animated images are not supported");
  if (
    width > IMAGE_LIMITS.maxSidePixels ||
    height > IMAGE_LIMITS.maxSidePixels ||
    width * height > IMAGE_LIMITS.maxPixels
  ) {
    throw new Error("Image dimensions exceed limits");
  }

  try {
    await sharp(bytes, {
      failOn: "error",
      limitInputPixels: IMAGE_LIMITS.maxPixels,
    }).raw().toBuffer();
  } catch {
    throw new Error("Invalid image");
  }

  return Object.freeze({
    bytes,
    mimeType,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
