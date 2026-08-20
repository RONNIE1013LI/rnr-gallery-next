import { detectIntent, type CustomerServiceIntent } from "../intent-detection";
import type { ConversationContextItem } from "../repositories/customer-service-repository";

type ContextValue = ConversationContextItem | string;

function item(value: ContextValue): Readonly<{ role: "customer" | "staff"; text: string }> {
  return typeof value === "string" ? { role: "customer", text: value } : value;
}

export function resolveContextualIntent(input: Readonly<{
  currentText: string;
  history: readonly ContextValue[];
  baseIntent: CustomerServiceIntent;
}>): Readonly<{
  intent: CustomerServiceIntent;
  inherited: boolean;
  reason: string;
}> {
  if (input.baseIntent !== "unknown") {
    return { intent: input.baseIntent, inherited: false, reason: "explicit_current_intent" };
  }
  const history = input.history.map(item);
  const lastStaff = [...history].reverse().find((entry) => entry.role === "staff");
  const staffText = lastStaff?.text ?? "";
  const current = input.currentText.trim();
  if (
    lastStaff
    && /\b(?:country|area|location|located|address|size|date|day|when|how many (?:photos?|faces?|people)|wording|theme)\b/i.test(staffText)
  ) {
    return { intent: "quote_information_collection", inherited: true, reason: "pending_quote_detail" };
  }
  if (
    lastStaff
    && /\b(?:which|would|wall|freestanding|product|format|canvas|banner|roll[ -]?up)\b/i.test(staffText)
    && /\b(?:this|that|one|yes|yeah|canvas|banner|roll[ -]?up|wall|freestanding)\b/i.test(current)
  ) {
    return { intent: "product_differences", inherited: true, reason: "pending_product_choice" };
  }
  if (/\b(?:find|send|try|look for)\b.*\b(?:another|original|photo|image|one)\b/i.test(current)) {
    const priorPhotoContext = history.slice(0, -1).some((entry) => (
      detectIntent(entry.text) === "photo_guidance"
      || /\b(?:photo|image|blurry|original file)\b/i.test(entry.text)
    ));
    if (priorPhotoContext) {
      return { intent: "photo_guidance", inherited: true, reason: "continued_photo_guidance" };
    }
  }
  const priorIntent = [...history.slice(0, -1)].reverse()
    .map((entry) => detectIntent(entry.text))
    .find((intent) => intent !== "unknown" && intent !== "tone_adjustment");
  if (priorIntent && /^(?:yes|yeah|this one|that one)$/i.test(current)) {
    return { intent: priorIntent, inherited: true, reason: "short_confirmation" };
  }
  return { intent: "unknown", inherited: false, reason: "no_safe_context_match" };
}
