function databaseTarget(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null;
    }
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return null;
  }
}

export function isDedicatedTestDatabase(
  testDatabaseUrl: string | undefined,
  applicationDatabaseUrl: string | undefined,
): boolean {
  if (!testDatabaseUrl || !applicationDatabaseUrl) return false;

  const testTarget = databaseTarget(testDatabaseUrl);
  const applicationTarget = databaseTarget(applicationDatabaseUrl);
  if (!testTarget || !applicationTarget || testTarget === applicationTarget) {
    return false;
  }

  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  return /(?:^|[-_])test(?:$|[-_])/.test(databaseName);
}
