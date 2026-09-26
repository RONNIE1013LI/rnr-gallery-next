import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferThirdPartyTransport } from "./deferred-third-party";

describe("deferred third-party transport", () => {
  let cancel: (() => void) | undefined;
  let idleCallback: IdleRequestCallback;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 7;
    }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });
  afterEach(() => {
    cancel?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("waits for load, then idle, and activates only once", () => {
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    vi.advanceTimersByTime(5_000);
    expect(activate).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_500 });
    expect(activate).not.toHaveBeenCalled();
    idleCallback({ didTimeout: false, timeRemaining: () => 20 });
    window.dispatchEvent(new Event("pointerdown"));
    vi.runAllTimers();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
  });
  it("activates by 2500ms even if idle never arrives", () => {
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(2_499);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it.each(["pointerdown", "touchstart", "keydown"])("%s activates before load", (event) => {
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    window.dispatchEvent(new Event(event));
    expect(activate).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("load"));
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
  });
  it("uses a 250ms timeout without requestIdleCallback, including after load", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    vi.advanceTimersByTime(249);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it("respects the original load deadline when hydration finishes late", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    vi.stubGlobal("performance", {
      now: () => 3_000,
      getEntriesByType: () => [{ loadEventEnd: 1_000 }],
    });
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    vi.advanceTimersByTime(499);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it("cancels idle, timers and interaction listeners on disposal", () => {
    const activate = vi.fn();
    cancel = deferThirdPartyTransport(activate);
    window.dispatchEvent(new Event("load"));
    cancel();
    idleCallback({ didTimeout: false, timeRemaining: () => 20 });
    window.dispatchEvent(new Event("keydown"));
    vi.runAllTimers();
    expect(activate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
