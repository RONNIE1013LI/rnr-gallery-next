// @vitest-environment node
import sharp from "sharp";
import { expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ options: null as Record<string, unknown> | null, pathname: "" }));
vi.mock("@vercel/blob", () => ({ put: async (pathname: string, _bytes: Uint8Array, options: Record<string, unknown>) => { blob.pathname = pathname; blob.options = options; }, get: async () => null }));
import { normalizeSupplyImage, persistSupplyImage, SUPPLIES_IMAGE_LIMITS, validateSupplyStorageKey } from "./media";

it("normalizes real raster bytes to metadata-free WebP and bounds delivery dimensions", async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#aabbcc" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "Synthetic fixture" } } }).toBuffer();
  const result = await normalizeSupplyImage(source, "image/jpeg");
  const metadata = await sharp(result.bytes).metadata();
  expect(result).toMatchObject({ width: 2000, height: 1000, mimeType: "image/webp" });
  expect(metadata.format).toBe("webp");
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
});
it("rejects MIME spoofing, SVG, tiny images and excessive payloads", async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await expect(normalizeSupplyImage(png, "image/jpeg")).rejects.toThrow("Invalid image");
  await expect(normalizeSupplyImage(Buffer.from("<svg/>"), "image/svg+xml")).rejects.toThrow("Upload JPEG");
  const small = await sharp({ create: { width: 99, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await expect(normalizeSupplyImage(small, "image/png")).rejects.toThrow("Invalid image");
  await expect(normalizeSupplyImage(new Uint8Array(SUPPLIES_IMAGE_LIMITS.maximumBytes + 1), "image/png")).rejects.toThrow("3 MiB");
});
it("accepts a 3 MiB raster but rejects a larger file before decoding", async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const maximumFile = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024 - png.length)]);
  await expect(normalizeSupplyImage(maximumFile, "image/png")).resolves.toMatchObject({ width: 100, height: 100 });
  await expect(normalizeSupplyImage(Buffer.concat([maximumFile, Buffer.from([0])]), "image/png")).rejects.toThrow("3 MiB");
});
it("rejects a small palette PNG whose normalized WebP exceeds the delivery limit", async () => {
  const pixels = Buffer.alloc(2000 * 2000 * 4);
  let seed = 0x12345678;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const colors = Array.from({ length: 16 }, () => Array.from({ length: 4 }, () => next() & 255));
  for (let pixel = 0; pixel < 2000 * 2000; pixel++) pixels.set(colors[next() & 15], pixel * 4);
  const png = await sharp(pixels, { raw: { width: 2000, height: 2000, channels: 4 } }).png({ palette: true, colours: 16, effort: 1 }).toBuffer();
  expect(png.length).toBeLessThan(3 * 1024 * 1024);
  await expect(normalizeSupplyImage(png, "image/png").then(() => undefined)).rejects.toThrow("Optimized image exceeds 3 MiB");
});
it("rejects animated WebP instead of silently publishing its first frame", async () => {
  const pixels = Buffer.alloc(100 * 200 * 3);
  for (let pixel = 0; pixel < 100 * 200; pixel++) pixels[pixel * 3 + (pixel < 100 * 100 ? 0 : 2)] = 255;
  const animated = await sharp(pixels, { raw: { width: 100, height: 200, pageHeight: 100, channels: 3 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(normalizeSupplyImage(animated, "image/webp")).rejects.toThrow("static JPEG");
});
it("accepts only owned supplies storage keys", () => {
  expect(validateSupplyStorageKey("supplies/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.webp")).toContain("supplies/");
  for (const value of ["../private.jpg", "customer-uploads/fixture.webp", "https://host.example/image.webp", "supplies/../../private.webp"]) expect(() => validateSupplyStorageKey(value)).toThrow();
});
it("persists only normalized images to private supplies-owned Blob paths", async () => {
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const stored = await persistSupplyImage("22222222-2222-4222-8222-222222222222", png, "image/png");
  expect(blob.options).toMatchObject({ access: "private", addRandomSuffix: false, contentType: "image/webp" });
  expect(blob.pathname).toBe(stored.storageKey);
  expect(stored.width).toBe(200);
  expect(stored.mimeType).toBe("image/webp");
});
