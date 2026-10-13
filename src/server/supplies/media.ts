import { createHash, randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import sharp from "sharp";
import { SUPPLIES_IMAGE_LIMITS } from "@/domain/supplies/image-limits";
import { SuppliesValidationError } from "./validation";

export { SUPPLIES_IMAGE_LIMITS } from "@/domain/supplies/image-limits";

export async function normalizeSupplyImage(bytes: Uint8Array, mimeType: string) {
  if (!bytes.length || bytes.length > SUPPLIES_IMAGE_LIMITS.maximumBytes) throw new SuppliesValidationError(`Images must be between 1 byte and ${SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB`);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new SuppliesValidationError("Upload JPEG, PNG or WebP images");
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: SUPPLIES_IMAGE_LIMITS.maximumPixels, animated: false });
    const metadata = await image.metadata();
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mimeType];
    if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("Invalid raster format");
    if (Math.min(metadata.width, metadata.height) < SUPPLIES_IMAGE_LIMITS.minimumDimension || Math.max(metadata.width, metadata.height) > SUPPLIES_IMAGE_LIMITS.maximumDimension) throw new Error("Invalid dimensions");
    const { data, info } = await image.rotate().resize({ width: SUPPLIES_IMAGE_LIMITS.outputDimension, height: SUPPLIES_IMAGE_LIMITS.outputDimension, fit: "inside", withoutEnlargement: true }).webp({ quality: 86, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (data.length > SUPPLIES_IMAGE_LIMITS.maximumBytes) throw new SuppliesValidationError(`Optimized image exceeds ${SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB; reduce its dimensions or re-export it`);
    return { bytes: data, width: info.width, height: info.height, byteLength: data.length, contentHash: createHash("sha256").update(data).digest("hex"), mimeType: "image/webp" as const };
  } catch (error) {
    if (error instanceof SuppliesValidationError) throw error;
    throw new SuppliesValidationError("Invalid image: use a static JPEG, PNG or WebP from 100 to 12000 pixels per side (40 megapixels maximum)");
  }
}

export function validateSupplyStorageKey(key: string) {
  if (!/^supplies\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/.test(key)) throw new SuppliesValidationError("Invalid supplies image storage key");
  return key;
}

export async function persistSupplyImage(ownerId: string, bytes: Uint8Array, mimeType: string) {
  const normalized = await normalizeSupplyImage(bytes, mimeType);
  const storageKey = validateSupplyStorageKey(`supplies/${ownerId}/${randomUUID()}.webp`);
  // Private storage prevents draft images and customer-source media from becoming public URLs.
  await put(storageKey, normalized.bytes, { access: "private", addRandomSuffix: false, contentType: normalized.mimeType });
  const { bytes: _, ...metadata } = normalized;
  void _;
  return { storageKey, ...metadata };
}

export async function readSupplyImageBytes(storageKey: string) {
  const blob = await get(validateSupplyStorageKey(storageKey), { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new SuppliesValidationError("Image not found", 404);
  return { bytes: Buffer.from(await new Response(blob.stream).arrayBuffer()), mimeType: "image/webp" as const };
}
