import { describe, expect, it } from "vitest";
import { parsePilotArguments } from "./configure-reply-assistant-pilot";

describe("reply assistant pilot configuration", () => {
  it("requires every explicit argument", () => {
    expect(() => parsePilotArguments([])).toThrow("Usage:");
    expect(() => parsePilotArguments(["--name", "pilot"])).toThrow("Usage:");
  });

  it("accepts one explicit bounded Facebook pilot", () => {
    expect(parsePilotArguments([
      "--name", "facebook-100",
      "--channel", "facebook",
      "--limit", "100",
      "--status", "disabled",
    ])).toEqual({ name: "facebook-100", channel: "facebook", limit: 100, status: "disabled" });
  });

  it("rejects unknown, duplicate and unsafe values", () => {
    expect(() => parsePilotArguments([
      "--name", "x", "--channel", "facebook", "--limit", "0", "--status", "active",
    ])).toThrow("Usage:");
    expect(() => parsePilotArguments([
      "--name", "x", "--channel", "whatsapp", "--limit", "100", "--status", "active",
    ])).toThrow("Usage:");
  });
});
