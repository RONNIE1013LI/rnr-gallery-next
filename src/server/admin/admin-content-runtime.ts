import { getDatabase } from "@/server/db/client";
import {
  getPublicContent,
  listAdminContent,
  publishContent,
  saveContentDraft,
  resolvePublishedContent,
  type ContentKey,
} from "./content-service";

export async function getSafePublicContent<K extends ContentKey>(keys: readonly K[]) {
  try {
    return await getPublicContent(getDatabase(), keys);
  } catch {
    return resolvePublishedContent([], keys);
  }
}

export function getAdminContentRuntime() {
  const database = getDatabase();
  return Object.freeze({
    list: () => listAdminContent(database),
    public: <K extends Parameters<typeof getPublicContent>[1][number]>(keys: readonly K[]) =>
      getPublicContent(database, keys),
    saveDraft: (
      actor: Parameters<typeof saveContentDraft>[1],
      input: Parameters<typeof saveContentDraft>[2],
    ) => saveContentDraft(database, actor, input),
    publish: (
      actor: Parameters<typeof publishContent>[1],
      input: Parameters<typeof publishContent>[2],
    ) => publishContent(database, actor, input),
  });
}
