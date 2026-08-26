import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function fsyncDirectory(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeFileVerified(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${Date.now()}-${process.pid}-${randomUUID()}.partial`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const stored = await readFile(temporary);
    if (!stored.equals(bytes)) throw new Error("Backup write read-back verification failed");
    await rename(temporary, path);
    await fsyncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
