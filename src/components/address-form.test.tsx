import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AddressInput } from "@/domain/address/types";
import { AddressForm } from "./address-form";

const emptyAddress: AddressInput = {
  country: "NZ",
  fullName: "",
  building: "",
  street: "",
  suburb: "",
  region: "",
  postcode: "",
  phone: "",
  email: "",
};

function ControlledAddressForm({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState(emptyAddress);

  return (
    <form aria-label="Address details">
      <AddressForm disabled={disabled} errors={{}} onChange={setValue} value={value} />
    </form>
  );
}

describe("AddressForm", () => {
  it("renders the country control first and associates every label with its control", () => {
    render(<ControlledAddressForm />);

    const form = screen.getByRole("form", { name: "Address details" });
    const country = screen.getByLabelText("Country");
    expect(form.querySelectorAll("input, select")[0]).toBe(country);
    expect(within(form).getAllByRole("combobox")[0]).toBe(country);
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Building / unit (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("Suburb")).toBeInTheDocument();
    expect(screen.getByLabelText("Region / city")).toBeInTheDocument();
    expect(screen.getByLabelText("Postcode")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("switches to the canonical Australian state selector and clears an incompatible region", () => {
    render(<ControlledAddressForm />);

    fireEvent.change(screen.getByLabelText("Region / city"), {
      target: { value: "Auckland" },
    });
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "AU" },
    });

    const state = screen.getByLabelText("State / territory");
    expect(state).toHaveValue("");
    expect(within(state).getByRole("option", { name: "NSW" })).toBeInTheDocument();
    expect(within(state).getByRole("option", { name: "NT" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Region / city")).not.toBeInTheDocument();
  });

  it("uses a constrained four-digit numeric postcode input for both countries", () => {
    render(<ControlledAddressForm />);

    const postcode = screen.getByLabelText("Postcode");
    expect(postcode).toHaveAttribute("inputMode", "numeric");
    expect(postcode).toHaveAttribute("pattern", "[0-9]{4}");
    expect(postcode).toHaveAttribute("maxLength", "4");

    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "AU" },
    });
    expect(screen.getByLabelText("Postcode")).toHaveAttribute("inputMode", "numeric");
  });

  it("associates field errors with their controls and disables every control when pending", () => {
    const { rerender } = render(
      <AddressForm
        disabled={false}
        errors={{ postcode: ["Enter a four-digit postcode"] }}
        onChange={() => undefined}
        value={emptyAddress}
      />,
    );

    const postcode = screen.getByLabelText("Postcode");
    expect(postcode).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a four-digit postcode")).toHaveAttribute(
      "id",
      postcode.getAttribute("aria-describedby"),
    );

    rerender(
      <AddressForm
        disabled
        errors={{}}
        onChange={() => undefined}
        value={emptyAddress}
      />,
    );
    const controls = [
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ];
    for (const control of controls) {
      expect(control).toBeDisabled();
    }
  });
});
