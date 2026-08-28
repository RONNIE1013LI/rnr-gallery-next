export function buildLegacyProductUrl(
  slug: string,
  values: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(values)) {
    const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of entries) {
      if (value !== undefined) query.append(key, value);
    }
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/products/${encodeURIComponent(slug)}${suffix}`;
}
