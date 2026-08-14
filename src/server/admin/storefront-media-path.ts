import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const imageExtension = /\.(?:avif|jpe?g|png|webp)$/i;

function decodedMediaSegments(imageSrc: string) {
  if (!imageSrc.startsWith("/media/") || imageSrc.includes("\\") || /[?#\0]/.test(imageSrc)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(imageSrc);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/media/") || decoded.includes("\\") || /[?#\0]/.test(decoded)) {
    return null;
  }
  const relative = decoded.slice("/media/".length);
  const segments = relative.split("/");
  if (!imageExtension.test(relative) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

export async function storefrontMediaExists(
  imageSrc: string,
  projectRoot = process.cwd(),
) {
  const segments = decodedMediaSegments(imageSrc);
  if (!segments) return false;
  try {
    const mediaRoot = await realpath(path.join(projectRoot, "public", "media"));
    const candidate = await realpath(path.join(mediaRoot, ...segments));
    if (candidate !== mediaRoot && !candidate.startsWith(`${mediaRoot}${path.sep}`)) {
      return false;
    }
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
