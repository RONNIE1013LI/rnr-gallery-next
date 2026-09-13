import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function ControlledAddressForm({
  disabled = false,
  googleMapsApiKey = "",
}: {
  disabled?: boolean;
  googleMapsApiKey?: string;
}) {
  const [value, setValue] = useState(emptyAddress);

  return (
    <form aria-label="Address details">
      <AddressForm
        disabled={disabled}
        errors={{}}
        googleMapsApiKey={googleMapsApiKey}
        onChange={setValue}
        value={value}
      />
    </form>
  );
}

describe("AddressForm", () => {
  afterEach(() => {
    delete (window as Window & { google?: unknown }).google;
  });

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

  it("shows the checkout market as a read-only country instead of a manual selector", () => {
    render(
      <AddressForm
        lockedCountry="AU"
        onChange={() => undefined}
        value={{ ...emptyAddress, country: "AU" }}
      />,
    );

    const country = screen.getByLabelText("Country");
    expect(country).toHaveRole("textbox");
    expect(country).toHaveAttribute("readonly");
    expect(country).toHaveValue("Australia");
    expect(screen.queryByRole("combobox", { name: "Country" })).not.toBeInTheDocument();
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

  it("clears country-specific location fields when the country changes", () => {
    render(<ControlledAddressForm />);

    fireEvent.change(screen.getByLabelText("Building / unit (optional)"), { target: { value: "Unit 4" } });
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "12 Queen Street" } });
    fireEvent.change(screen.getByLabelText("Suburb"), { target: { value: "Auckland Central" } });
    fireEvent.change(screen.getByLabelText("Region / city"), { target: { value: "Auckland" } });
    fireEvent.change(screen.getByLabelText("Postcode"), { target: { value: "1010" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AU" } });

    expect(screen.getByLabelText("Building / unit (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Street address")).toHaveValue("");
    expect(screen.getByLabelText("Suburb")).toHaveValue("");
    expect(screen.getByLabelText("State / territory")).toHaveValue("");
    expect(screen.getByLabelText("Postcode")).toHaveValue("");
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

  it("exposes the server address length limits in the browser controls", () => {
    render(<ControlledAddressForm />);

    expect(screen.getByLabelText("Full name")).toHaveAttribute("maxLength", "120");
    expect(screen.getByLabelText("Building / unit (optional)")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("Street address")).toHaveAttribute("maxLength", "180");
    expect(screen.getByLabelText("Suburb")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("Region / city")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("maxLength", "32");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("maxLength", "254");
  });

  it("inherits the 48px minimum control height from the shared form-field contract", () => {
    render(<ControlledAddressForm />);

    const form = screen.getByRole("form", { name: "Address details" });
    for (const control of form.querySelectorAll("input, select")) {
      expect(getComputedStyle(control).minHeight).toBe("48px");
    }
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

  it("keeps the complete manual address form when Google Places is not configured", () => {
    render(<ControlledAddressForm googleMapsApiKey="" />);

    expect(screen.queryByText("Find your address")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("Suburb")).toBeInTheDocument();
    expect(screen.getByLabelText("Postcode")).toBeInTheDocument();
  });

  it("uses the Google autocomplete as the street address control without a duplicate search field", async () => {
    (window as Window & { google?: unknown }).google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: {
            fetchAutocompleteSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
          },
        }),
      },
    };

    render(<ControlledAddressForm googleMapsApiKey="test-browser-key" />);

    await screen.findByText(
      "Choose a suggestion to fill Suburb, Region / city and Postcode, or enter the address manually.",
    );
    const street = screen.getByLabelText("Street address");
    expect(screen.getAllByLabelText("Street address")).toHaveLength(1);
    expect(screen.queryByText("Find your address")).not.toBeInTheDocument();
    expect(street.tagName).toBe("INPUT");
    expect(street).toHaveAttribute("name", "street");
    expect(street).toHaveAttribute("maxlength", "180");
    expect(document.querySelector("gmp-place-autocomplete")).not.toBeInTheDocument();
  });

  it("keeps Google address suggestions inline with the mobile checkout form", async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({
      suggestions: [{
        placePrediction: {
          text: { toString: () => "67 Hobson Street, Auckland CBD, Auckland" },
          toPlace: () => ({
            fetchFields: vi.fn().mockResolvedValue(undefined),
            addressComponents: [],
          }),
        },
      }],
    });
    (window as Window & { google?: unknown }).google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: { fetchAutocompleteSuggestions },
        }),
      },
    };

    render(<ControlledAddressForm googleMapsApiKey="test-browser-key" />);
    const street = await screen.findByLabelText("Street address");
    expect(street.tagName).toBe("INPUT");

    fireEvent.change(street, { target: { value: "67 Hobson" } });
    const suggestions = await screen.findByRole("listbox", {
      name: "Address suggestions",
    });
    expect(screen.getByRole("form", { name: "Address details" })).toContainElement(
      suggestions,
    );
    expect(within(suggestions).getByText(
      "67 Hobson Street, Auckland CBD, Auckland",
    )).toBeInTheDocument();
  });

  it("dismisses address suggestions while checkout is reviewed and does not reopen them when controls unlock", async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({
      suggestions: [{
        placePrediction: {
          text: { toString: () => "65 Fielding Road, Drury, Auckland" },
          toPlace: () => ({
            fetchFields: vi.fn().mockResolvedValue(undefined),
            addressComponents: [],
          }),
        },
      }],
    });
    (window as Window & { google?: unknown }).google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: { fetchAutocompleteSuggestions },
        }),
      },
    };

    const view = render(
      <ControlledAddressForm googleMapsApiKey="test-browser-key" />,
    );
    const street = await screen.findByLabelText("Street address");
    fireEvent.focus(street);
    fireEvent.change(street, { target: { value: "65 Fielding Road" } });
    expect(await screen.findByRole("listbox", {
      name: "Address suggestions",
    })).toBeInTheDocument();

    fireEvent.blur(street);
    view.rerender(
      <ControlledAddressForm disabled googleMapsApiKey="test-browser-key" />,
    );
    expect(screen.queryByRole("listbox", {
      name: "Address suggestions",
    })).not.toBeInTheDocument();

    view.rerender(
      <ControlledAddressForm googleMapsApiKey="test-browser-key" />,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(screen.queryByRole("listbox", {
      name: "Address suggestions",
    })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "65 Fielding Road, Drury" },
    });
    expect(await screen.findByRole("listbox", {
      name: "Address suggestions",
    })).toBeInTheDocument();
  });

  it("waits for the Google callback when the async loader finishes before the runtime is ready", async () => {
    const importLibrary = vi.fn().mockResolvedValue({
      AutocompleteSessionToken: function AutocompleteSessionToken() {},
      AutocompleteSuggestion: {
        fetchAutocompleteSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
      },
    });

    render(<ControlledAddressForm googleMapsApiKey="test-browser-key" />);

    const script = await waitFor(() => {
      const candidate = document.querySelector<HTMLScriptElement>(
        "script[data-rnr-google-maps]",
      );
      expect(candidate).not.toBeNull();
      return candidate!;
    });

    await act(async () => {
      fireEvent.load(script);
      await Promise.resolve();
    });

    expect(screen.getByText(
      "Address suggestions are loading. You can keep typing manually.",
    )).toBeInTheDocument();
    const callbackName = new URL(script.src).searchParams.get("callback");
    expect(callbackName).not.toBeNull();

    (window as Window & { google?: unknown }).google = {
      maps: { importLibrary },
    };
    await act(async () => {
      const callback = (window as unknown as Record<string, unknown>)[callbackName!];
      expect(callback).toBeTypeOf("function");
      (callback as () => void)();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(
      "Choose a suggestion to fill Suburb, Region / city and Postcode, or enter the address manually.",
    )).toBeInTheDocument());
    expect(importLibrary).toHaveBeenCalledWith("places");
  });

  it("fills an NZ address from a Google prediction while preserving manual contact fields", async () => {
    const fetchFields = vi.fn().mockResolvedValue(undefined);
    const place = {
      addressComponents: [
        { longText: "11", shortText: "11", types: ["street_number"] },
        { longText: "Para Close", shortText: "Para Close", types: ["route"] },
        { longText: "Fairview Heights", shortText: "Fairview Heights", types: ["sublocality_level_1"] },
        { longText: "Auckland", shortText: "Auckland", types: ["locality"] },
        { longText: "0632", shortText: "0632", types: ["postal_code"] },
        { longText: "New Zealand", shortText: "NZ", types: ["country"] },
      ],
      fetchFields,
    };
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({
      suggestions: [{
        placePrediction: {
          text: { toString: () => "11 Para Close, Fairview Heights, Auckland" },
          toPlace: () => place,
        },
      }],
    });
    const importLibrary = vi.fn().mockResolvedValue({
      AutocompleteSessionToken: function AutocompleteSessionToken() {},
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
    });
    (window as Window & { google?: unknown }).google = { maps: { importLibrary } };

    render(<ControlledAddressForm googleMapsApiKey="test-browser-key" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ronnie Lee" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+64 21 023 48948" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ronnie@example.test" } });

    const street = screen.getByLabelText("Street address");
    fireEvent.change(street, { target: { value: "11 Para" } });
    fireEvent.click(await screen.findByRole("option", {
      name: "11 Para Close, Fairview Heights, Auckland",
    }));

    await waitFor(() => expect(screen.getByLabelText("Street address")).toHaveValue("11 Para Close"));
    expect(importLibrary).toHaveBeenCalledWith("places");
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      includedPrimaryTypes: ["street_address"],
      includedRegionCodes: ["nz"],
      input: "11 Para",
      language: "en-NZ",
      region: "nz",
    }));
    expect(fetchFields).toHaveBeenCalledWith({ fields: ["addressComponents"] });
    expect(screen.getByLabelText("Suburb")).toHaveValue("Fairview Heights");
    expect(screen.getByLabelText("Region / city")).toHaveValue("Auckland");
    expect(screen.getByLabelText("Postcode")).toHaveValue("0632");
    expect(screen.getByLabelText("Full name")).toHaveValue("Ronnie Lee");
    expect(screen.getByLabelText("Phone")).toHaveValue("+64 21 023 48948");
    expect(screen.getByLabelText("Email address")).toHaveValue("ronnie@example.test");
  });

  it("updates Google predictions to Australia when the selected country changes", async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
    (window as Window & { google?: unknown }).google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: { fetchAutocompleteSuggestions },
        }),
      },
    };

    render(<ControlledAddressForm googleMapsApiKey="test-browser-key" />);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AU" } });
    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "67 Hobson" },
    });

    await waitFor(() => expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        includedRegionCodes: ["au"],
        input: "67 Hobson",
        language: "en-AU",
        region: "au",
      }),
    ));
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
  });
});
