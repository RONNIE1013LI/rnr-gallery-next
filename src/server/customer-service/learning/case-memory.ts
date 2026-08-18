export function assessCaseMemoryEligibility(input: Readonly<{
  riskClass: "low" | "medium" | "high";
  gateReasons: readonly string[];
  customerSituation: string;
  humanReply: string;
  redactionCodes: readonly string[];
}>) {
  const value = `${input.customerSituation}\n${input.humanReply}`;
  const codes: string[] = [];
  if (input.riskClass === "high" || input.gateReasons.some((reason) => /high_risk|unresolved/i.test(reason))) codes.push("high_risk");
  if (/\bdiscount\b|special price|price override/i.test(value)) codes.push("special_discount");
  if (/\bcompensation\b|store credit/i.test(value)) codes.push("compensation");
  if (/\brefund\b|\bcancell?ation\b/i.test(value)) codes.push("refund_or_cancellation");
  if (/damaged|misprint|reprint|consumer rights/i.test(value)) codes.push("damaged_or_misprint");
  if (/chargeback|payment dispute/i.test(value)) codes.push("payment_dispute");
  if (/(?:NZ|AU)?\$\s?\d+(?:\.\d{1,2})?\b|shipping (?:was|is|costs?)\s+\d/i.test(value)) codes.push("realtime_value");
  if (/arrive (?:today|tomorrow|by)|guaranteed delivery|delivery guarantee|ETA\b/i.test(value)) codes.push("delivery_or_eta");
  if (/one[- ]off shipping|special delivery arrangement|temporary promotion/i.test(value)) codes.push("one_off_or_promotion");
  if (input.gateReasons.some((reason) => /realtime/i.test(reason))) codes.push("realtime_source");
  if (input.redactionCodes.length) codes.push("sensitive_source");
  const exclusionCodes = [...new Set(codes)];
  return Object.freeze(exclusionCodes.length
    ? { eligible: false as const, status: "excluded" as const, exclusionCodes: Object.freeze(exclusionCodes) }
    : { eligible: true as const, status: "pending_review" as const, exclusionCodes: Object.freeze([] as string[]) });
}
