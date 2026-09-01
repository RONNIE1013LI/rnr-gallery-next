export const SAFE_AUTH_RETURN_ROOTS = [
  "/account",
  "/admin",
  "/checkout",
  "/forms",
  "/order-system",
  "/reply-assistant",
] as const;

const unsafeDecodedCharacter = /[\\\u0000-\u001f\u007f]/;
const encodedPathDelimiter = /%(?:2f|3f|23|5c)/i;

function decodeCanonicalPathname(pathname: string): string | null {
  let current = pathname;

  for (let depth = 0; depth < 8; depth += 1) {
    if (encodedPathDelimiter.test(current)) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }

    if (unsafeDecodedCharacter.test(decoded) || decoded.startsWith("//")) return null;

    const segments = decoded.split("/");
    const pathSegments = decoded.endsWith("/") ? segments.slice(1, -1) : segments.slice(1);
    if (pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      return null;
    }

    if (decoded === current) return decoded;
    current = decoded;
  }

  return null;
}

export function safeAuthReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  let decodedValue: string;
  try {
    decodedValue = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  if (decodedValue.startsWith("//") || unsafeDecodedCharacter.test(decodedValue)) return fallback;

  const separatorIndex = value.search(/[?#]/);
  const pathname = separatorIndex === -1 ? value : value.slice(0, separatorIndex);
  const canonicalPathname = decodeCanonicalPathname(pathname);
  if (!canonicalPathname) return fallback;

  const allowed = SAFE_AUTH_RETURN_ROOTS.some((root) =>
    canonicalPathname === root || canonicalPathname.startsWith(`${root}/`),
  );
  if (!allowed) return fallback;

  return value;
}
