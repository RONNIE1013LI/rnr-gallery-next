type SiteEnvironment = Readonly<{
  [key: string]: string | undefined;
  BETTER_AUTH_URL?: string;
}>;

const fallback = new URL("https://rrgallery.co.nz");

export function getSiteUrl(environment: SiteEnvironment = process.env) {
  const raw = environment.BETTER_AUTH_URL?.trim();
  if (!raw) return new URL(fallback);
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return new URL(fallback);
    }
    return new URL(url.origin);
  } catch {
    return new URL(fallback);
  }
}
