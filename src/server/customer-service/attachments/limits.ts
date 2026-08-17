export const IMAGE_LIMITS = Object.freeze({
  maxCount: 5,
  maxBytesPerImage: 4 * 1024 * 1024,
  maxBatchBytes: 12 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxSidePixels: 8192,
  maxRedirects: 2,
  perImageTimeoutMs: 10_000,
  batchTimeoutMs: 20_000,
  retentionMs: 24 * 60 * 60 * 1000,
} as const);
