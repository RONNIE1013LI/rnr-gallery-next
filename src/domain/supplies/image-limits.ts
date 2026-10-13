// Leave multipart overhead below Vercel's 4.5 MB function payload limit.
export const SUPPLIES_IMAGE_LIMITS = Object.freeze({ maximumBytes: 3 * 1024 * 1024, maximumRequestBytes: 4 * 1024 * 1024, maximumPixels: 40_000_000, minimumDimension: 100, maximumDimension: 12_000, outputDimension: 2000 });
