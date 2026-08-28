const preservedParameters = ["design", "rnr_design", "reviews"] as const;
const paidClickParameters = ["gclid", "gbraid", "wbraid", "fbclid"] as const;

export function buildLegacyProductUrl(
  slug: string,
  values: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const key of preservedParameters) {
    const rawValue = values[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value) query.set(key, value);
  }
  for (const [key, rawValue] of Object.entries(values)) {
    if (!key.startsWith("utm_")) continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value) query.set(key, value);
  }
  for (const key of paidClickParameters) {
    const rawValue = values[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/products/${encodeURIComponent(slug)}${suffix}`;
}
