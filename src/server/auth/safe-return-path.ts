const allowedRoot = /^\/(?:account|admin|checkout|forms|order-system)(?:[/?#]|$)/;
const unsafeDecodedCharacter = /[\\\u0000-\u001f\u007f]/;

export function safeAuthReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (
    decoded.startsWith("//") ||
    unsafeDecodedCharacter.test(decoded) ||
    !allowedRoot.test(decoded)
  ) {
    return fallback;
  }
  return value;
}
