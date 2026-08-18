export function chooseHumanReplyTurn(input: Readonly<{
  explicitTurnId: string | null;
  hasExplicitReference: boolean;
  eligibleTurnIds: readonly string[];
}>) {
  if (input.explicitTurnId && input.eligibleTurnIds.includes(input.explicitTurnId)) {
    return Object.freeze({
      status: "matched" as const,
      turnId: input.explicitTurnId,
      method: "reply_to" as const,
      confidence: "high" as const,
    });
  }
  if (input.hasExplicitReference) {
    return Object.freeze({ status: "unmatched" as const, method: "none" as const, confidence: "low" as const });
  }
  if (input.eligibleTurnIds.length === 1) {
    return Object.freeze({
      status: "matched" as const,
      turnId: input.eligibleTurnIds[0],
      method: "single_eligible_turn" as const,
      confidence: "high" as const,
    });
  }
  return Object.freeze({ status: "unmatched" as const, method: "none" as const, confidence: "low" as const });
}
