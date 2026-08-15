const publicIdPrefixPattern = /^[a-f0-9]{8}$/;

export function publicDesignTitle(
  design: Readonly<{ subOccasion: string | null; altText: string }>,
): string {
  return design.subOccasion?.trim() || design.altText.trim();
}

export function buildPublicDesignSlug(title: string, designId: string): string {
  const prefix = designId.slice(0, 8).toLowerCase();
  if (!publicIdPrefixPattern.test(prefix)) {
    throw new Error("A public design slug requires a hexadecimal design ID");
  }
  const readable = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "") || "design";
  return `${readable}-${prefix}`;
}

export function publicDesignIdPrefixFromSlug(slug: string): string | null {
  const match = slug.match(/^.+-([a-f0-9]{8})$/);
  return match?.[1] ?? null;
}
