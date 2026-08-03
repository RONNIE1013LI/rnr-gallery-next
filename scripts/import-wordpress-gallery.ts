import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseGalleryConfig } from "@/server/gallery/config";
import { createDrizzleGalleryRepository } from "@/server/gallery/drizzle-gallery-repository";
import { parseGalleryImportArguments } from "@/server/gallery/import-cli";
import { importWordPressGallery } from "@/server/gallery/import-wordpress-gallery";
import { LocalGalleryStore } from "@/server/gallery/local-gallery-store";
import { getDatabase } from "@/server/db/client";

const arguments_ = parseGalleryImportArguments(process.argv.slice(2));
const config = parseGalleryConfig();
const result = await importWordPressGallery({
  manifestPath: arguments_.manifestPath,
  imagesDir: arguments_.imagesDir,
  repository: createDrizzleGalleryRepository(getDatabase()),
  store: new LocalGalleryStore(config),
});
const report = {
  importedAt: new Date().toISOString(),
  expected: 357,
  ...result,
};
await mkdir(dirname(arguments_.reportPath), { recursive: true });
const temporaryReport = `${arguments_.reportPath}.tmp-${process.pid}`;
await writeFile(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
await rename(temporaryReport, arguments_.reportPath);
process.stdout.write(
  `Gallery import complete: ${result.imported} imported, ${result.unchanged} unchanged.\n`,
);
