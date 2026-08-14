import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storefrontMediaExists } from "./storefront-media-path";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), "rnr-media-path-"));
  roots.push(root);
  await mkdir(path.join(root, "public", "media", "home"), { recursive: true });
  await writeFile(path.join(root, "public", "media", "home", "canvas.webp"), "image");
  return root;
}

describe("storefront media paths", () => {
  it("accepts only a real image file contained by public/media", async () => {
    const root = await project();

    await expect(storefrontMediaExists("/media/home/canvas.webp", root)).resolves.toBe(true);
    await expect(storefrontMediaExists("/media/home/missing.webp", root)).resolves.toBe(false);
    await expect(storefrontMediaExists("/media/home", root)).resolves.toBe(false);
  });

  it.each([
    "/media/../secret.webp",
    "/media/%2e%2e/secret.webp",
    "/media/home/canvas.webp?download=1",
    "/media/home/canvas.svg",
    "/media\\home\\canvas.webp",
    "/uploads/canvas.webp",
  ])("rejects unsafe or unsupported path %s", async (imageSrc) => {
    await expect(storefrontMediaExists(imageSrc, await project())).resolves.toBe(false);
  });

  it("rejects a symlink that escapes the media root", async () => {
    const root = await project();
    const outside = path.join(root, "outside.webp");
    await writeFile(outside, "private");
    await symlink(outside, path.join(root, "public", "media", "home", "linked.webp"));

    await expect(storefrontMediaExists("/media/home/linked.webp", root)).resolves.toBe(false);
  });
});
