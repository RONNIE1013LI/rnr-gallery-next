import { describe, expect, it } from "vitest";
import { assembleConversationContext } from "./assembler";
import type { ConversationTurn } from "../types";

function turn(
  providerMessageKey: string,
  role: ConversationTurn["role"],
  sentAt: string,
  text: string,
): ConversationTurn {
  return {
    providerMessageKey,
    role,
    sentAt,
    text,
    channel: "meta",
    attachmentOrdinals: [],
  };
}

describe("assembleConversationContext", () => {
  it("orders by timestamp and stable provider key while removing exact provider duplicates", () => {
    const result = assembleConversationContext([
      turn("c", "customer", "2026-09-04T01:00:01.000Z", "third"),
      turn("b", "staff", "2026-09-04T01:00:00.000Z", "second"),
      turn("a", "customer", "2026-09-04T01:00:00.000Z", "first"),
      turn("a", "customer", "2026-09-04T01:00:00.000Z", "duplicate"),
    ]);

    expect(result.turns.map((entry) => entry.providerMessageKey)).toEqual(["a", "b", "c"]);
    expect(result.turns.map((entry) => entry.role)).toEqual(["customer", "staff", "customer"]);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.turnsConsidered).toBe(4);
  });

  it("merges only the adjacent customer fragments in the latest unanswered request", () => {
    const result = assembleConversationContext([
      turn("1", "customer", "2026-09-04T01:00:00.000Z", "Earlier customer"),
      turn("2", "staff", "2026-09-04T01:01:00.000Z", "Earlier staff"),
      turn("3", "customer", "2026-09-04T01:02:00.000Z", "A2 please"),
      turn("4", "customer", "2026-09-04T01:02:01.000Z", "with five people"),
    ]);

    expect(result.turns).toHaveLength(3);
    expect(result.turns[1].role).toBe("staff");
    expect(result.turns[2].text).toBe("A2 please\nwith five people");
    expect(result.turns[2].providerMessageKey).toBe("3+4");
    expect(result.fragmentsMerged).toBe(1);
  });

  it("retains latest text verbatim and compacts old non-material turns deterministically", () => {
    const oldText = `hello ${"x".repeat(500)}`;
    const latestText = `latest ${"z".repeat(220)}`;
    const input = [
      turn("1", "customer", "2026-09-01T01:00:00.000Z", oldText),
      turn("2", "staff", "2026-09-01T01:01:00.000Z", "Thanks"),
      turn("3", "customer", "2026-09-04T01:00:00.000Z", latestText),
    ];

    const first = assembleConversationContext(input, { maxCharacters: 420 });
    const second = assembleConversationContext(input, { maxCharacters: 420 });

    expect(first).toEqual(second);
    expect(first.compacted).toBe(true);
    expect(first.modelText).toContain(latestText);
    expect(first.modelText.length).toBeLessThanOrEqual(420);
    expect(first.turnsConsidered).toBe(input.length);
  });

  it("preserves old material facts verbatim when they fit", () => {
    const material = "The quoted price is NZ$262.20 including GST and payment is pending.";
    const result = assembleConversationContext([
      turn("1", "staff", "2026-09-01T01:00:00.000Z", material),
      turn("2", "customer", "2026-09-04T01:00:00.000Z", `Thanks ${"x".repeat(300)}`),
    ], { maxCharacters: 520 });

    expect(result.modelText).toContain(material);
    expect(result.incompleteMaterialContext).toBe(false);
  });

  it("marks material context incomplete rather than silently truncating a required fact", () => {
    const material = `Refund policy and payment amount NZ$262.20: ${"x".repeat(500)}`;
    const result = assembleConversationContext([
      turn("1", "staff", "2026-09-01T01:00:00.000Z", material),
      turn("2", "customer", "2026-09-04T01:00:00.000Z", "Can you confirm?"),
    ], { maxCharacters: 220 });

    expect(result.incompleteMaterialContext).toBe(true);
    expect(result.modelText).not.toContain(material);
    expect(result.modelText).toContain("material context omitted");
  });
});
