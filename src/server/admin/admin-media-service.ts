import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import { getProductRegistryRuntime } from "./product-registry-runtime";

export type AdminMediaFile = Readonly<{
  name: string;
  url: string;
  sizeBytes: number;
  modifiedAt: Date;
  usedBy?: readonly string[];
}>;

type ProductMediaReference = Readonly<{
  title: string;
  image: Readonly<{ src: string }>;
}>;

function comparableUrl(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function attachProductMediaUsage(
  files: readonly AdminMediaFile[],
  products: readonly ProductMediaReference[],
) {
  const usage = new Map<string, string[]>();
  for (const product of products) {
    const key = comparableUrl(product.image.src);
    const titles = usage.get(key) ?? [];
    if (!titles.includes(product.title)) titles.push(product.title);
    usage.set(key, titles);
  }
  const found = new Set(files.map((file) => comparableUrl(file.url)));
  return Object.freeze({
    storefront: Object.freeze(files.map((file) => Object.freeze({
      ...file,
      usedBy: Object.freeze(usage.get(comparableUrl(file.url)) ?? []),
    }))),
    missingProductMedia: Object.freeze(products.flatMap((product) =>
      found.has(comparableUrl(product.image.src)) ? [] : [Object.freeze({
        title: product.title,
        imageSrc: product.image.src,
      })],
    )),
  });
}

async function walk(directory: string, root: string, depth = 0): Promise<AdminMediaFile[]> {
  if (depth > 5) return [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const output: AdminMediaFile[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute, root, depth + 1));
    if (!entry.isFile() || !/\.(?:avif|jpe?g|png|webp)$/i.test(entry.name)) continue;
    const details = await stat(absolute);
    const relative = path.relative(root, absolute).split(path.sep).map(encodeURIComponent).join("/");
    output.push(Object.freeze({ name: relative, url: `/media/${relative}`, sizeBytes: details.size, modifiedAt: details.mtime }));
  }
  return output;
}

export async function listAdminMedia() {
  const mediaRoot = path.join(process.cwd(), "public", "media");
  const [files, gallery, productRegistry] = await Promise.all([
    walk(mediaRoot, mediaRoot),
    getAdminGalleryService().list(),
    getProductRegistryRuntime().current(),
  ]);
  const usage = attachProductMediaUsage(
    files.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime()),
    productRegistry.registry.products,
  );
  return Object.freeze({
    storefront: usage.storefront,
    missingProductMedia: usage.missingProductMedia,
    gallery: Object.freeze(gallery),
  });
}
