import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageProtectionLayer } from "./image-protection";

describe("ImageProtectionLayer", () => {
  it("does not alter ordinary copied page text", () => {
    render(<ImageProtectionLayer />);
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "Customer address",
    } as Selection);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });
});
