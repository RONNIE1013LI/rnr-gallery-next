import type { CustomerServiceIntent } from "./intent-detection";

export function buildDraftPrompt(input: Readonly<{
  intent: CustomerServiceIntent;
  context: readonly string[];
  rules: readonly Readonly<{ id: string; text: string }>[];
  examples: readonly Readonly<{ customer: string; reply: string }>[];
  toneGuide: string;
}>) {
  const rules = input.rules.map((rule) => `${rule.id}: ${rule.text}`).join("\n");
  const examples = input.examples.map((example) => `Customer: ${example.customer}\nReply: ${example.reply}`).join("\n\n");
  return {
    instructions: [
      "Write one short R&R Gallery customer-service draft in natural English.",
      "This is a suggestion for human review. Never send or claim that it was sent.",
      "Use only the confirmed rules below as business facts.",
      "Do not quote live prices, dates, availability, order data or unconfirmed policy.",
      "Use two to five short lines, restrained emoji and one useful next step.",
      "Do not mention AI, policy status, internal risk or the knowledge base.",
      `Detected intent: ${input.intent}`,
      `CONFIRMED RULES:\n${rules}`,
      `TONE GUIDE:\n${input.toneGuide.slice(0, 5_000)}`,
      `STYLE EXAMPLES ONLY:\n${examples.slice(0, 4_000)}`,
    ].join("\n\n"),
    input: [
      "Current same-customer conversation:",
      ...input.context.slice(-6).map((message, index) => `${index + 1}. ${message}`),
      "Return only the proposed customer reply.",
    ].join("\n"),
  };
}
