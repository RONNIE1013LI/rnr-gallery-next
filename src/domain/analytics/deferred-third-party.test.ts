import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferThirdPartyTransport, requestThirdPartyTransport } from "./deferred-third-party";

describe("staggered third-party transport", () => {
  const cleanups: Array<() => void> = [];
  let idleCallback: IdleRequestCallback | undefined;
  const idle = () => idleCallback?.({ didTimeout: false, timeRemaining: () => 20 });
  beforeEach(() => {
    vi.useFakeTimers();
    idleCallback = undefined;
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 7;
    }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });
  afterEach(() => {
    cleanups.splice(0).forEach((cancel) => cancel());
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  it("never offers GA4 idle work before load plus 1000ms", () => {
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport("ga4", activate));
    vi.advanceTimersByTime(5000);
    expect(activate).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    for (const elapsed of [100, 400, 499]) {
      vi.advanceTimersByTime(elapsed); idle();
      expect(window.requestIdleCallback).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(1); idle();
    expect(activate).toHaveBeenCalledTimes(1);
    vi.runAllTimers(); idle();
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it.each(["ga4", "google-ads", "meta"] as const)("%s has an independent hard fallback", (phase) => {
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport(phase, activate));
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime((phase === "ga4" ? 1500 : 5000) - 1);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledOnce();
  });
  it.each(["google-ads", "meta"] as const)("%s cannot activate before 4000ms on passive viewing", (phase) => {
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport(phase, activate));
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(3999); idle();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); idle();
    expect(activate).toHaveBeenCalledOnce();
  });
  it("touch, pointer, keyboard and scroll do not activate transports", () => {
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport("meta", activate));
    for (const name of ["pointerdown", "touchstart", "keydown", "scroll"]) window.dispatchEvent(new Event(name));
    expect(activate).not.toHaveBeenCalled();
  });
  it("only wakes the explicitly requested transport for a meaningful action", () => {
    const ads = vi.fn(), meta = vi.fn();
    cleanups.push(deferThirdPartyTransport("google-ads", ads), deferThirdPartyTransport("meta", meta));
    requestThirdPartyTransport("google-ads");
    expect(ads).toHaveBeenCalledOnce(); expect(meta).not.toHaveBeenCalled();
    requestThirdPartyTransport("meta");
    expect(meta).toHaveBeenCalledOnce();
  });
  it("uses the load-relative fallback without idle support", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport("ga4", activate));
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(1499); expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(activate).toHaveBeenCalledOnce();
  });
  it("uses the original load time when hydration is late", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    vi.stubGlobal("performance", { now: () => 2200, getEntriesByType: () => [{ loadEventEnd: 1000 }] });
    const activate = vi.fn();
    cleanups.push(deferThirdPartyTransport("ga4", activate));
    vi.advanceTimersByTime(299); expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(activate).toHaveBeenCalledOnce();
  });
  it("cancels idle, both timers and the action listener", () => {
    const activate = vi.fn();
    const cancel = deferThirdPartyTransport("ga4", activate);
    window.dispatchEvent(new Event("load")); vi.advanceTimersByTime(1000);
    cancel(); idle(); requestThirdPartyTransport("ga4"); vi.runAllTimers();
    expect(activate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
