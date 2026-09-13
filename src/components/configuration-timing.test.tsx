import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationTiming } from "./configuration-timing";

describe("ConfigurationTiming contextual help", () => {
  it.each(["NZ", "AU"] as const)("offers timing help for %s without replacing the active form or changing advisory dates", (market) => {
    const onChange = vi.fn();
    render(<ConfigurationTiming orderDate="2026-09-14" needByDate="2020-01-01" productionDate="2026-09-17" market={market} deliveryPreference="post" onChange={onChange} />);
    const help = screen.getByRole("link", { name: "Timing and delivery help (opens in new tab)" });
    expect(help).toHaveAttribute("href", "/help#timing");
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", "noopener noreferrer");
    const date = screen.getByLabelText("When do you need the finished item?");
    expect(date).toHaveValue("2020-01-01");
    expect(date).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByText(/Dates are advisory only/)).toBeVisible();
    fireEvent.change(date, { target: { value: "2020-01-02" } });
    expect(onChange).toHaveBeenCalledWith("2020-01-02");
  });
});
