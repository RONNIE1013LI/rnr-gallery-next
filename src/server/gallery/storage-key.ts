const storageKeyPattern = /^(?:(?:managed|revisions)\/[a-f0-9-]+|generations\/[a-zA-Z0-9_-]+\/[a-f0-9-]+)\.(?:jpe?g|png|webp)$/;

export function validateGalleryStorageKey(value: string): string {
  if (
    !storageKeyPattern.test(value) ||
    value.includes("..") ||
    value.includes("\\") ||
    value.startsWith("/")
  ) {
    throw new Error("Invalid gallery storage key");
  }
  return value;
}
