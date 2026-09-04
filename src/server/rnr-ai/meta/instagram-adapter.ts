import type { MetaConversationEvent } from "./types";

export function normalizeInstagramMetaEvents(
  _payload: unknown,
  options: Readonly<{ enabled?: boolean }> = {},
): readonly MetaConversationEvent[] {
  if (!options.enabled) return [];
  return [];
}
