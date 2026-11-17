import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerReviewsSection } from "./customer-reviews-section";
import { featuredReview, secondReview } from "./test-fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["clock", "formatter"])("keeps the server-rendered review dates when the browser %s differs", async (difference) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-20T23:59:59Z"));
  // This server component runs once; its client boundaries hydrate later.
  const section = CustomerReviewsSection({ data: {
    summary: null, featured: featuredReview, reviews: [secondReview],
  } });
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(section);
  const dates = Array.from(container.querySelectorAll("time"), node => node.textContent);
  if (difference === "clock") {
    vi.setSystemTime(new Date("2026-08-21T00:00:01Z"));
  } else {
    vi.spyOn(Intl.RelativeTimeFormat.prototype, "format").mockReturnValue("different browser wording");
  }
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, section, { onRecoverableError: error => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(Array.from(container.querySelectorAll("time"), node => node.textContent)).toEqual(dates);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it("hydrates formatted emoji after the server HTML is encoded as UTF-8", async () => {
  const { ReviewText } = await import("./review-text");
  const text = "A😊B";
  const base = { font: "default" as const, size: 16, bold: false, italic: false };
  const ui = <p><ReviewText text={text} style={{ ...base, ranges: [{ ...base, from: 0, to: 2, bold: true }] }} /></p>;
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = Buffer.from(renderToString(ui), "utf8").toString("utf8");
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: error => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe(text);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
