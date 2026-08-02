import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    });
    expect(await readFile(join(directory, "upload-id.bin"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(JSON.parse(await readFile(join(directory, "upload-id.json"), "utf8")))
      .toEqual(reference);
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
