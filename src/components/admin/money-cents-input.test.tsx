import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { MoneyCentsInput } from "./money-cents-input";

it("selects a zero amount so typing replaces 0.00 and formats it on blur", () => {
  const onCentsChange = vi.fn();
  function StatefulMoneyInput() {
    const [cents, setCents] = useState(0);
    return <MoneyCentsInput
      ariaLabel="Amount payable"
      cents={cents}
      onCentsChange={(next) => {
        onCentsChange(next);
        setCents(next);
      }}
    />;
  }
  render(<StatefulMoneyInput />);

  const input = screen.getByLabelText("Amount payable") as HTMLInputElement;
  fireEvent.focus(input);

  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(4);

  input.setSelectionRange(4, 4);
  fireEvent.click(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(4);

  fireEvent.change(input, { target: { value: "230" } });
  fireEvent.blur(input);

  expect(input).toHaveValue("230.00");
  expect(onCentsChange).toHaveBeenLastCalledWith(23_000);
});

it("does not select an existing non-zero amount on focus", () => {
  render(
    <MoneyCentsInput
      ariaLabel="Amount paid"
      cents={23_000}
      onCentsChange={vi.fn()}
    />,
  );

  const input = screen.getByLabelText("Amount paid") as HTMLInputElement;
  fireEvent.focus(input);

  expect(input.selectionStart).toBe(input.selectionEnd);
});
