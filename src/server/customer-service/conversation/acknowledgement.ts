type HistoryItem = Readonly<{ role: "customer" | "staff"; text: string }>;

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPendingStaffQuestion(item: HistoryItem) {
  if (item.role !== "staff") return false;
  const value = item.text.trim();
  return /\?\s*$/.test(value)
    || /\b(?:which|what|where|when|would|do|does|did|can|could|how many|how much)\b/i.test(value);
}

export function classifyAcknowledgement(input: Readonly<{
  currentText: string;
  recentHistory: readonly HistoryItem[];
}>) {
  const value = normalized(input.currentText);
  const completedAcknowledgements = new Set([
    "thanks",
    "thanks so much",
    "thank you",
    "thank you so much",
    "okay",
    "ok",
    "got it",
    "all good",
  ]);
  if (completedAcknowledgements.has(value)) {
    return { suppress: true as const, reason: "completed_acknowledgement" as const };
  }
  if (value === "yes" || value === "yeah" || value === "yep") {
    const lastStaff = [...input.recentHistory].reverse().find((item) => item.role === "staff");
    if (!lastStaff || !isPendingStaffQuestion(lastStaff)) {
      return { suppress: true as const, reason: "completed_acknowledgement" as const };
    }
  }
  return { suppress: false as const, reason: null };
}
