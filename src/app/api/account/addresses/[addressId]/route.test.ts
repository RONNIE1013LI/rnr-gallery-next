import { describe, expect, it } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type {
  AddressRepository,
  SavedAddress,
} from "@/server/addresses/address-repository";
import { createAddressItemHandlers } from "./route";

const ownerId = "owner-a";
const foreignOwnerId = "owner-b";
const addressId = "address-1";
const now = new Date("2026-08-02T00:00:00.000Z");

const storedAddress: SavedAddress = {
  id: addressId,
  ownerId,
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "Unit 4",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64211234567",
  email: "aroha@example.test",
  createdAt: now,
  updatedAt: now,
};

const auAddress = {
  country: "AU",
  fullName: "Mia Chen",
  building: "Level 2",
  street: "55 George Street",
  suburb: "Sydney",
  region: "NSW",
  postcode: "2000",
  phone: "0412 345 678",
  email: "mia@example.test",
} as const;

function createMemoryRepository(initial: SavedAddress[]): AddressRepository {
  const addresses = [...initial];

  return {
    async listByOwner(requestOwnerId) {
      return addresses.filter((address) => address.ownerId === requestOwnerId);
    },
    async findByOwner(requestOwnerId, requestedAddressId) {
      return addresses.find(
        (address) =>
          address.ownerId === requestOwnerId &&
          address.id === requestedAddressId,
      ) ?? null;
    },
    async create(requestOwnerId, input: NormalizedAddress) {
      const address = {
        ...input,
        id: `address-${addresses.length + 1}`,
        ownerId: requestOwnerId,
        createdAt: now,
        updatedAt: now,
      };
      addresses.push(address);
      return address;
    },
    async updateByOwner(requestOwnerId, requestedAddressId, input) {
      const index = addresses.findIndex(
        (address) =>
          address.ownerId === requestOwnerId &&
          address.id === requestedAddressId,
      );
      if (index < 0) return null;

      const updated = { ...addresses[index], ...input, updatedAt: now };
      addresses[index] = updated;
      return updated;
    },
    async deleteByOwner(requestOwnerId, requestedAddressId) {
      const index = addresses.findIndex(
        (address) =>
          address.ownerId === requestOwnerId &&
          address.id === requestedAddressId,
      );
      if (index < 0) return false;
      addresses.splice(index, 1);
      return true;
    },
  };
}

function updateRequest(body: unknown) {
  return new Request(
    `http://localhost/api/account/addresses/${addressId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(requestedAddressId = addressId) {
  return { params: Promise.resolve({ addressId: requestedAddressId }) };
}

describe("/api/account/addresses/[addressId]", () => {
  it("updates an address for its owner with normalized Australian details", async () => {
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository([storedAddress]),
    });

    const response = await handlers.PUT(updateRequest(auAddress), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      address: {
        id: addressId,
        ownerId,
        country: "AU",
        region: "NSW",
        postcode: "2000",
        phone: "+61412345678",
      },
    });
  });

  it("returns the same 404 contract for a foreign-owned address", async () => {
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: foreignOwnerId } }),
      repository: createMemoryRepository([storedAddress]),
    });

    const response = await handlers.PUT(updateRequest(auAddress), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Address not found" },
    });
  });

  it("returns the same 404 contract for a missing address", async () => {
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository([storedAddress]),
    });

    const response = await handlers.DELETE(
      new Request("http://localhost/api/account/addresses/missing", {
        method: "DELETE",
      }),
      context("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Address not found" },
    });
  });

  it("deletes an address for its owner with an empty 204 response", async () => {
    const repository = createMemoryRepository([storedAddress]);
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository,
    });

    const response = await handlers.DELETE(
      new Request(`http://localhost/api/account/addresses/${addressId}`, {
        method: "DELETE",
      }),
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    await expect(repository.findByOwner(ownerId, addressId)).resolves.toBeNull();
  });
});
