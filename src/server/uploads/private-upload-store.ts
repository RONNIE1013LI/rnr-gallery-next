import { BlobPrivateUploadStore } from "./blob-private-upload-store";
import {
  LocalPrivateUploadStore,
  privateUploadDirectory,
} from "./local-private-upload-store";

export type PrivateUploadStore = Pick<
  LocalPrivateUploadStore,
  "save" | "read" | "remove"
>;

export function createPrivateUploadStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PrivateUploadStore {
  const blobToken = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (blobToken) {
    return new BlobPrivateUploadStore(blobToken);
  }
  return new LocalPrivateUploadStore(privateUploadDirectory(env));
}
