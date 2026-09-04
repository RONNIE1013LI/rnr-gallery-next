import type { ConversationTurn } from "../types";

const DEFAULT_MAX_CHARACTERS = 60_000;
const MATERIAL_FACT = /(?:NZ\$|A\$|\b(?:NZD|AUD|GST|price|quote|payment|paid|refund|cancel|policy|deadline|arriv|deliver|ship|working day|business day)\b|\b\d{4}-\d{2}-\d{2}\b)/i;

export type AssembledConversationContext = Readonly<{
  turns: readonly ConversationTurn[];
  modelText: string;
  turnsConsidered: number;
  duplicatesRemoved: number;
  fragmentsMerged: number;
  compacted: boolean;
  incompleteMaterialContext: boolean;
  totalSourceCharacters: number;
  modelCharacters: number;
}>;

function sanitizeText(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function normalizeTurn(turn: ConversationTurn): ConversationTurn {
  return Object.freeze({
    ...turn,
    providerMessageKey: turn.providerMessageKey.trim(),
    sentAt: new Date(turn.sentAt).toISOString(),
    text: sanitizeText(turn.text),
    attachmentOrdinals: Object.freeze([...turn.attachmentOrdinals]),
  });
}

function formatTurn(turn: ConversationTurn, text = turn.text) {
  return `[${turn.sentAt}] ${turn.role}: ${text}`;
}

function mergeLatestCustomerFragments(turns: readonly ConversationTurn[]) {
  if (turns.length < 2 || turns.at(-1)?.role !== "customer") {
    return { turns, fragmentsMerged: 0 };
  }
  let start = turns.length - 1;
  while (start > 0 && turns[start - 1].role === "customer") start -= 1;
  if (start === turns.length - 1) return { turns, fragmentsMerged: 0 };

  const fragments = turns.slice(start);
  const merged: ConversationTurn = Object.freeze({
    ...fragments[0],
    providerMessageKey: fragments.map((turn) => turn.providerMessageKey).join("+"),
    sentAt: fragments.at(-1)!.sentAt,
    text: fragments.map((turn) => turn.text).filter(Boolean).join("\n"),
    attachmentOrdinals: Object.freeze(fragments.flatMap((turn) => turn.attachmentOrdinals)),
  });
  return {
    turns: Object.freeze([...turns.slice(0, start), merged]),
    fragmentsMerged: fragments.length - 1,
  };
}

function buildModelText(turns: readonly ConversationTurn[], maxCharacters: number) {
  const full = turns.map((turn) => formatTurn(turn));
  const fullText = full.join("\n");
  if (fullText.length <= maxCharacters) {
    return { modelText: fullText, compacted: false, incompleteMaterialContext: false };
  }

  const selected = new Map<number, string>();
  let remaining = maxCharacters;
  let incompleteMaterialContext = false;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const mustKeep = index === turns.length - 1;
    const candidate = full[index];
    if (candidate.length + 1 <= remaining) {
      selected.set(index, candidate);
      remaining -= candidate.length + 1;
      if (!mustKeep && remaining < Math.floor(maxCharacters * 0.35)) break;
      continue;
    }
    if (mustKeep) {
      throw new Error("Latest conversation turn exceeds the model character budget");
    }
    break;
  }

  for (let index = 0; index < turns.length; index += 1) {
    if (selected.has(index)) continue;
    const turn = turns[index];
    if (MATERIAL_FACT.test(turn.text)) {
      const candidate = full[index];
      if (candidate.length + 1 <= remaining) {
        selected.set(index, candidate);
        remaining -= candidate.length + 1;
      } else {
        const marker = formatTurn(turn, `[material context omitted: ${turn.text.length} chars]`);
        if (marker.length + 1 <= remaining) {
          selected.set(index, marker);
          remaining -= marker.length + 1;
        }
        incompleteMaterialContext = true;
      }
      continue;
    }
    const marker = formatTurn(turn, `[earlier message compacted: ${turn.text.length} chars]`);
    if (marker.length + 1 <= remaining) {
      selected.set(index, marker);
      remaining -= marker.length + 1;
    }
  }

  return {
    modelText: [...selected.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text)
      .join("\n"),
    compacted: true,
    incompleteMaterialContext,
  };
}

export function assembleConversationContext(
  sourceTurns: readonly ConversationTurn[],
  options: Readonly<{ maxCharacters?: number }> = {},
): AssembledConversationContext {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer");
  }

  const sorted = sourceTurns.map(normalizeTurn).sort((left, right) => (
    left.sentAt.localeCompare(right.sentAt)
    || left.providerMessageKey.localeCompare(right.providerMessageKey)
  ));
  const seen = new Set<string>();
  const deduplicated = sorted.filter((turn) => {
    if (seen.has(turn.providerMessageKey)) return false;
    seen.add(turn.providerMessageKey);
    return true;
  });
  const merged = mergeLatestCustomerFragments(deduplicated);
  const model = buildModelText(merged.turns, maxCharacters);

  return Object.freeze({
    turns: Object.freeze([...merged.turns]),
    modelText: model.modelText,
    turnsConsidered: sourceTurns.length,
    duplicatesRemoved: sourceTurns.length - deduplicated.length,
    fragmentsMerged: merged.fragmentsMerged,
    compacted: model.compacted,
    incompleteMaterialContext: model.incompleteMaterialContext,
    totalSourceCharacters: sourceTurns.reduce((total, turn) => total + turn.text.length, 0),
    modelCharacters: model.modelText.length,
  });
}
