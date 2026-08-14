export function normalizeShippingServiceName(value: string) {
  return value.replace(/\bAuckalnd\b/gi, "Auckland");
}
