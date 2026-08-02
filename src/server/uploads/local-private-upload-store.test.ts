import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidUploadError,
  LocalPrivateUploadStore,
} from "./local-private-upload-store";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rnr-private-upload-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LocalPrivateUploadStore", () => {
  it("stores image bytes and safe metadata outside the public tree", async () => {
    const directory = await temporaryDirectory();
    const store = new LocalPrivateUploadStore(directory, () => "upload-id");
    const file = new File([new Uint8Array([1, 2, 3])], "family photo.jpg", {
      type: "image/jpeg",
    });

    const reference = await store.save(file);

    expect(reference).toEqual({
      id: "upload-id",
      originalName: "family photo.jpg",
      mimeType: "image/jpeg",
      size: 3,
      storageKey: "upload-id.bin",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(await readFile(join(directory, "upload-id.bin"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(JSON.parse(await readFile(join(directory, "upload-id.json"), "utf8")))
      .toEqual(reference);
  });

  it("removes the private bytes and metadata for a stored upload", async () => {
    const directory = await temporaryDirectory();
    const store = new LocalPrivateUploadStore(directory, () => "upload-id");
    const reference = await store.save(
      new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" }),
    );

    await store.remove(reference);

    await expect(access(join(directory, "upload-id.bin"))).rejects.toThrow();
    await expect(access(join(directory, "upload-id.json"))).rejects.toThrow();
  });

  it("cleans the file it wrote when the metadata write fails", async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "upload-id.json"), "existing", { flag: "wx" });
    const store = new LocalPrivateUploadStore(directory, () => "upload-id");

    await expect(
      store.save(new File(["photo"], "photo.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow();

    await expect(access(join(directory, "upload-id.bin"))).rejects.toThrow();
    expect(await readFile(join(directory, "upload-id.json"), "utf8")).toBe("existing");
  });

  it("rejects unsupported formats and oversized files", async () => {
    const store = new LocalPrivateUploadStore(await temporaryDirectory());

    await expect(
      store.save(new File(["text"], "notes.txt", { type: "text/plain" })),
    ).rejects.toBeInstanceOf(InvalidUploadError);

    const oversized = {
      name: "large.jpg",
      type: "image/jpeg",
      size: 25 * 1024 * 1024 + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await expect(store.save(oversized)).rejects.toBeInstanceOf(InvalidUploadError);
  });
});
