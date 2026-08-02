import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type {
  AddressRepository,
  SavedAddress,
} from "@/server/addresses/address-repository";
import { createAddressItemHandlers } from "./route";

const ownerId = "owner-a";
const foreignOwnerId = "owner-b";
const addressId = "00000000-0000-4000-8000-000000000001";
const missingAddressId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-02T00:00:00.000Z");
const trustedOrigin = "https://shop.example.test";
const testSecret = "test-only-auth-secret-32-characters";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", trustedOrigin);
  vi.stubEnv("BETTER_AUTH_SECRET", testSecret);
});

afterEach(() => vi.unstubAllEnvs());

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

const nzAddress = {
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "Unit 4",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "021 123 4567",
  email: "aroha@example.test",
} as const;

function rejectLikePostgresUuid(value: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`invalid input syntax for type uuid: "${value}"`);
  }
}

function createMemoryRepository(initial: SavedAddress[]): AddressRepository {
  const addresses = [...initial];

  return {
    async listByOwner(requestOwnerId) {
      return addresses.filter((address) => address.ownerId === requestOwnerId);
    },
    async findByOwner(requestOwnerId, requestedAddressId) {
      rejectLikePostgresUuid(requestedAddressId);
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
      rejectLikePostgresUuid(requestedAddressId);
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
      rejectLikePostgresUuid(requestedAddressId);
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

function updateRequest(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(
    `http://localhost/api/account/addresses/${addressId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: trustedOrigin,
        "Sec-Fetch-Site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function deleteRequest(
  requestedAddressId: string,
  headers: Record<string, string> = {},
) {
  return new Request(
    `http://localhost/api/account/addresses/${requestedAddressId}`,
    {
      method: "DELETE",
      headers: {
        Origin: trustedOrigin,
        "Sec-Fetch-Site": "same-origin",
        ...headers,
      },
    },
  );
}

function context(requestedAddressId = addressId) {
  return { params: Promise.resolve({ addressId: requestedAddressId }) };
}

describe("/api/account/addresses/[addressId]", () => {
  it("updates an address for its owner with normalized New Zealand details", async () => {
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository([storedAddress]),
    });

    const response = await handlers.PUT(updateRequest(nzAddress), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      address: {
        id: addressId,
        ownerId,
        country: "NZ",
        region: "Auckland",
        postcode: "1010",
        phone: "+64211234567",
      },
    });
  });

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
      deleteRequest(missingAddressId),
      context(missingAddressId),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Address not found" },
    });
  });

  it("returns 404 for a malformed ID before a PostgreSQL UUID comparison", async () => {
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository([storedAddress]),
    });

    const response = await handlers.DELETE(
      deleteRequest("missing"),
      context("missing"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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
      deleteRequest(addressId),
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    await expect(repository.findByOwner(ownerId, addressId)).resolves.toBeNull();
  });

  it.each([
    [
      "a foreign origin",
      { Origin: "https://attacker.example" },
      403,
      "FORBIDDEN",
    ],
    [
      "a text/plain body",
      { "Content-Type": "text/plain" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
  ])(
    "rejects an update with %s before changing the address",
    async (_name, headers, status, code) => {
      const repository = createMemoryRepository([storedAddress]);
      const handlers = createAddressItemHandlers({
        requireSession: async () => ({ user: { id: ownerId } }),
        repository,
      });

      const response = await handlers.PUT(
        updateRequest(auAddress, headers),
        context(),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      await expect(repository.findByOwner(ownerId, addressId)).resolves.toEqual(
        storedAddress,
      );
    },
  );

  it("rejects a cross-origin delete before removing the address", async () => {
    const repository = createMemoryRepository([storedAddress]);
    const handlers = createAddressItemHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository,
    });

    const response = await handlers.DELETE(
      deleteRequest(addressId, { Origin: "https://attacker.example" }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    await expect(repository.findByOwner(ownerId, addressId)).resolves.toEqual(
      storedAddress,
    );
  });
});
