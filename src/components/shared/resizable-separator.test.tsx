import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ResizableSeparator } from "./resizable-separator";

function Harness({
  initial = 480,
  direction = 1,
}: Readonly<{
  initial?: number;
  direction?: 1 | -1;
}>) {
  const [width, setWidth] = useState(initial);
  return <>
    <output data-testid="width">{width}</output>
    <ResizableSeparator
      label="Resize invoice editor"
      value={width}
      min={320}
      max={720}
      step={20}
      direction={direction}
      onChange={setWidth}
    />
  </>;
}

describe("ResizableSeparator", () => {
  it("exposes vertical separator values and resizes with the keyboard", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "Resize invoice editor" });

    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "320");
    expect(separator).toHaveAttribute("aria-valuemax", "720");
    expect(separator).toHaveAttribute("aria-valuenow", "480");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(screen.getByTestId("width")).toHaveTextContent("500");
    fireEvent.keyDown(separator, { key: "End" });
    expect(screen.getByTestId("width")).toHaveTextContent("720");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(screen.getByTestId("width")).toHaveTextContent("720");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(screen.getByTestId("width")).toHaveTextContent("320");
  });

  it("translates pointer movement from the drag start", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "Resize invoice editor" });
    Object.defineProperty(separator, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(separator, "releasePointerCapture", { configurable: true, value: vi.fn() });

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 560 });
    expect(screen.getByTestId("width")).toHaveTextContent("540");
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 560 });
  });

  it("reverses horizontal movement for a drawer left edge", () => {
    render(<Harness direction={-1} />);
    const separator = screen.getByRole("separator", { name: "Resize invoice editor" });

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(screen.getByTestId("width")).toHaveTextContent("500");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(screen.getByTestId("width")).toHaveTextContent("480");
  });
});
