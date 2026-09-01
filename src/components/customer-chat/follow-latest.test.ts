import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_LATEST_THRESHOLD_PX,
  isNearBottom,
  scrollTranscriptToLatest,
} from "./follow-latest";

describe("customer chat follow-latest geometry", () => {
  it.each([
    [900, 500, 400, true],
    [900, 500, 352, true],
    [900, 500, 351, false],
  ])(
    "uses the 48px near-bottom threshold for %i/%i/%i",
    (scrollHeight, clientHeight, scrollTop, expected) => {
      expect(isNearBottom({ scrollHeight, clientHeight, scrollTop })).toBe(expected);
    },
  );

  it("clamps a custom negative threshold to zero", () => {
    expect(isNearBottom({ scrollHeight: 900, clientHeight: 500, scrollTop: 399 }, -20))
      .toBe(false);
    expect(FOLLOW_LATEST_THRESHOLD_PX).toBe(48);
  });

  it("scrolls only the supplied transcript element", () => {
    const scrollTo = vi.fn();
    scrollTranscriptToLatest({ scrollHeight: 900, scrollTo }, "auto");

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
  });
});
