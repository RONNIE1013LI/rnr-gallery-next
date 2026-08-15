import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getAttributionStorageKey } from "@/domain/analytics/attribution";
import { AttributionCapture } from "./attribution-capture";

describe("AttributionCapture", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/shop?utm_source=google&gclid=click-1");
  });

  it("does not copy one tagged click to another identity on the same URL", async () => {
    const view = render(<AttributionCapture customerId={null} />);
    await waitFor(() => expect(sessionStorage.getItem(getAttributionStorageKey(null))).not.toBeNull());
    view.rerender(<AttributionCapture customerId="user-a" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionStorage.getItem(getAttributionStorageKey("user-a"))).toBeNull();
  });
});
