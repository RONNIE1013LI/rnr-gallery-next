import { describe, expect, it } from "vitest";
import { evaluateAiControl } from "./schedule";
import type { AiControlSnapshot } from "../runtime-store/reply-runtime-store";

function snapshot(overrides: Partial<AiControlSnapshot["config"]> = {}): AiControlSnapshot {
  return {
    readAt: "2026-09-04T00:00:00.000Z",
    config: {
      revision: 1,
      mode: "OFF",
      timezone: "Pacific/Auckland",
      periods: [],
      override: null,
      ...overrides,
    },
  };
}

describe("evaluateAiControl", () => {
  it.each([
    ["ON", "ON"],
    ["OFF", "OFF"],
  ] as const)("evaluates %s mode", (mode, state) => {
    expect(evaluateAiControl(snapshot({ mode }), new Date("2026-09-04T00:00:00Z"), true).effectiveState).toBe(state);
  });

  it("gives the master kill switch precedence over an ON override", () => {
    const result = evaluateAiControl(snapshot({
      mode: "ON",
      override: { state: "ON", expiresAt: "2026-09-04T01:00:00Z", actorUserId: "admin-1" },
    }), new Date("2026-09-04T00:00:00Z"), false);
    expect(result).toMatchObject({ effectiveState: "OFF", source: "master_kill" });
  });

  it("uses a non-expired override and ignores an expired one", () => {
    const active = snapshot({ mode: "OFF", override: { state: "ON", expiresAt: "2026-09-04T01:00:00Z", actorUserId: "admin-1" } });
    expect(evaluateAiControl(active, new Date("2026-09-04T00:00:00Z"), true).effectiveState).toBe("ON");
    expect(evaluateAiControl(active, new Date("2026-09-04T01:00:00Z"), true).effectiveState).toBe("OFF");
  });

  it.each([
    ["NZST", "2026-07-05T21:30:00Z"],
    ["NZDT", "2026-01-04T20:30:00Z"],
  ])("uses Pacific/Auckland correctly during %s", (_label, instant) => {
    const result = evaluateAiControl(snapshot({
      mode: "SCHEDULE",
      periods: [{ day: 1, start: "09:00", end: "17:00" }],
    }), new Date(instant), true);
    expect(result.effectiveState).toBe("ON");
    expect(result.nextTransitionAt).not.toBeNull();
  });

  it("supports an overnight period from the prior local day", () => {
    const result = evaluateAiControl(snapshot({
      mode: "SCHEDULE",
      periods: [{ day: 1, start: "22:00", end: "02:00" }],
    }), new Date("2026-07-06T13:00:00Z"), true);
    expect(result.effectiveState).toBe("ON");
  });

  it("fails closed for invalid schedule values", () => {
    const result = evaluateAiControl(snapshot({
      mode: "SCHEDULE",
      periods: [{ day: 1, start: "25:00", end: "17:00" }],
    }), new Date("2026-09-04T00:00:00Z"), true);
    expect(result).toMatchObject({ effectiveState: "OFF", source: "invalid" });
  });
});
