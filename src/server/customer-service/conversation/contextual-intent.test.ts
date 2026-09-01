import { describe, expect, it } from "vitest";
import { resolveContextualIntent } from "./contextual-intent";

const at = "2026-08-18T00:00:00.000Z";
const staff = (text: string) => ({ role: "staff" as const, text, receivedAt: at });
const customer = (text: string) => ({ role: "customer" as const, text, receivedAt: at });

describe("resolveContextualIntent", () => {
  it.each([
    ["Australia", "Which country are you in?"],
    ["New Zealand", "Is this for New Zealand or Australia?"],
    ["yeah woorabinda", "Which area are you located in?"],
    ["A1", "What size would you like?"],
    ["A2 3 people", "Which Canvas type would you like?"],
    ["next Saturday", "What date do you need it for?"],
    ["around 5 photos", "How many photos would you like to use?"],
  ])("maps contextual quote detail %s from the staff question", (currentText, question) => {
    expect(resolveContextualIntent({
      currentText,
      baseIntent: "unknown",
      history: [staff(question), customer(currentText)],
    })).toMatchObject({ intent: "quote_information_collection", inherited: true });
  });

  it("maps a product selection pronoun from a product-choice question", () => {
    expect(resolveContextualIntent({
      currentText: "this one",
      baseIntent: "unknown",
      history: [staff("Would you like a wall display or a freestanding option?"), customer("this one")],
    })).toMatchObject({ intent: "product_differences", inherited: true });
  });

  it("continues photo guidance when the customer will find another photo", () => {
    expect(resolveContextualIntent({
      currentText: "I'll try find another one",
      baseIntent: "unknown",
      history: [customer("My photo is blurry"), staff("Please send the original file for assessment."), customer("I'll try find another one")],
    })).toMatchObject({ intent: "photo_guidance", inherited: true });
  });

  it("uses an unrelated explicit new intent instead of stale context", () => {
    expect(resolveContextualIntent({
      currentText: "How does the deposit process work?",
      baseIntent: "payment_process",
      history: [staff("Which size would you like?"), customer("How does the deposit process work?")],
    })).toEqual({ intent: "payment_process", inherited: false, reason: "explicit_current_intent" });
  });
});
