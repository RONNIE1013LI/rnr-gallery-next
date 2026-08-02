import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedAddressView } from "./saved-addresses";
import { SavedAddresses } from "./saved-addresses";

const addressId = "00000000-0000-4000-8000-000000000001";
const savedAddress: SavedAddressView = {
  id: addressId,
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "Unit 4",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64211234567",
  email: "aroha@example.test",
};

const createdAddress: SavedAddressView = {
  ...savedAddress,
  id: "00000000-0000-4000-8000-000000000002",
  fullName: "Mia Chen",
  building: "",
  street: "55 George Street",
  suburb: "Sydney",
  country: "AU",
  region: "NSW",
  postcode: "2000",
  phone: "+61412345678",
  email: "mia@example.test",
};

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fillNewZealandForm(fullName = "Mia Chen") {
  const values: Record<string, string> = {
    "Full name": fullName,
    "Street address": "8 Willis Street",
    Suburb: "Te Aro",
    "Region / city": "Wellington",
    Postcode: "6011",
    Phone: "021 555 1234",
    "Email address": "mia@example.test",
  };

  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe("SavedAddresses", () => {
  it("renders saved details and a useful empty state", () => {
    const { unmount } = render(<SavedAddresses initialAddresses={[savedAddress]} />);

    expect(screen.getByRole("heading", { name: "Aroha Ngata" })).toBeInTheDocument();
    expect(screen.getByText(/12 Queen Street/)).toBeInTheDocument();

    unmount();
    render(<SavedAddresses initialAddresses={[]} />);
    expect(screen.getByText("You have no saved addresses yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add address" })).toBeInTheDocument();
  });

  it("creates an address through the collection API and renders the returned record", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: createdAddress }, 201));
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedAddresses initialAddresses={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    fillNewZealandForm();
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(await screen.findByRole("heading", { name: "Mia Chen" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/addresses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      country: "NZ",
      fullName: "Mia Chen",
      region: "Wellington",
      postcode: "6011",
    });
  });

  it("cancels edits without changing the saved record and keeps only one form open", () => {
    render(<SavedAddresses initialAddresses={[savedAddress, createdAddress]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getAllByRole("form", { name: "Edit saved address" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Changed name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("heading", { name: "Aroha Ngata" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edit saved address" })).not.toBeInTheDocument();
  });

  it("updates an address through its item API", async () => {
    const updated = { ...savedAddress, fullName: "Aroha Morgan" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: updated }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedAddresses initialAddresses={[savedAddress]} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aroha Morgan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update address" }));

    expect(await screen.findByRole("heading", { name: "Aroha Morgan" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/addresses/${addressId}`,
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      country: "NZ",
      fullName: "Aroha Morgan",
      building: "Unit 4",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "+64211234567",
      email: "aroha@example.test",
    });
  });

  it("keeps the address visible until a confirmed delete succeeds", async () => {
    let resolveDelete: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveDelete = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SavedAddresses initialAddresses={[savedAddress]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("group", { name: "Delete Aroha Ngata?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm delete" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/addresses/${addressId}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(screen.getByRole("heading", { name: "Aroha Ngata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    resolveDelete?.(new Response(null, { status: 204 }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Aroha Ngata" })).not.toBeInTheDocument();
    });
  });

  it("preserves entered values and announces field and general API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Address details are invalid",
              fields: { postcode: ["Postcode must contain four digits"] },
            },
          },
          422,
        ),
      ),
    );
    render(<SavedAddresses initialAddresses={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    fillNewZealandForm();
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(await screen.findByText("Address details are invalid")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByLabelText("Full name")).toHaveValue("Mia Chen");
    expect(screen.getByText("Postcode must contain four digits")).toBeInTheDocument();
    expect(screen.getByLabelText("Postcode")).toHaveAttribute("aria-invalid", "true");
  });

  it("disables and relabels the submit action while a request is pending", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(() => undefined)));
    render(<SavedAddresses initialAddresses={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    fillNewZealandForm();
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByLabelText("Full name")).toBeDisabled();
  });
});
