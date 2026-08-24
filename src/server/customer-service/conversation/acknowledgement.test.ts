import { describe, expect, it } from "vitest";
import { classifyAcknowledgement } from "./acknowledgement";

describe("classifyAcknowledgement", () => {
  it.each(["Thanks", "thank you 😊", "Okay", "ok", "got it", "all good"])(
    "suppresses a completed acknowledgement: %s",
    (currentText) => {
      expect(classifyAcknowledgement({ currentText, recentHistory: [] })).toEqual({
        suppress: true,
        reason: "completed_acknowledgement",
      });
    },
  );

  it("keeps yes when it answers a recent staff question", () => {
    expect(classifyAcknowledgement({
      currentText: "yes",
      recentHistory: [{ role: "staff", text: "Would you like a roll-up banner?" }],
    })).toEqual({ suppress: false, reason: null });
  });

  it("suppresses standalone yes when no question is pending", () => {
    expect(classifyAcknowledgement({
      currentText: "yes",
      recentHistory: [{ role: "staff", text: "Your draft is ready for review." }],
    })).toEqual({ suppress: true, reason: "completed_acknowledgement" });
  });

  it.each(["Australia", "A1", "around 5 photos", "next Saturday", "this one"])(
    "keeps a contextual short answer: %s",
    (currentText) => {
      expect(classifyAcknowledgement({ currentText, recentHistory: [] }))
        .toEqual({ suppress: false, reason: null });
    },
  );
});
