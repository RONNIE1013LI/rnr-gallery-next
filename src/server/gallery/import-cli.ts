export type GalleryImportArguments = Readonly<{
  manifestPath: string;
  imagesDir: string;
  reportPath: string;
}>;

export function parseGalleryImportArguments(
  arguments_: readonly string[],
): GalleryImportArguments {
  const values: {
    manifestPath?: string;
    imagesDir?: string;
    reportPath?: string;
  } = {};
  const keys = {
    "--manifest": "manifestPath",
    "--images": "imagesDir",
    "--report": "reportPath",
  } as const;

  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const key = keys[flag as keyof typeof keys];
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = arguments_[index + 1]?.trim();
    if (!value || arguments_[index + 2]?.startsWith("--") === false) {
      throw new Error(`${flag} requires one value`);
    }
    if (values[key]) throw new Error(`${flag} may be provided only once`);
    values[key] = value;
  }

  if (!values.manifestPath) throw new Error("--manifest is required");
  if (!values.imagesDir) throw new Error("--images is required");
  if (!values.reportPath) throw new Error("--report is required");
  return Object.freeze(values as GalleryImportArguments);
}
