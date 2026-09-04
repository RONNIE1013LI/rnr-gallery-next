const MODULE_SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;

export function hasForbiddenDatabaseImport(source: string) {
  for (const match of source.matchAll(MODULE_SPECIFIER_PATTERN)) {
    const moduleId = match[1] ?? "";
    if (
      moduleId.startsWith("@/server/db")
      || /(?:^|\/)drizzle(?:-|\/|$)/i.test(moduleId)
      || /(?:^|\/)customer_service_/i.test(moduleId)
      || /(?:^|\/)product-registry(?:\/|$)/i.test(moduleId)
    ) return true;
  }
  return false;
}
