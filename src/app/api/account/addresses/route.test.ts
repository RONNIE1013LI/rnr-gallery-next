import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type {
  AddressRepository,
  SavedAddress,
} from "@/server/addresses/address-repository";
import { HttpError } from "@/server/auth/require-session";
import { createAddressCollectionHandlers } from "./route";

const ownerId = "owner-a";
const now = new Date("2026-08-02T00:00:00.000Z");
const trustedOrigin = "https://shop.example.test";
const testSecret = "test-only-auth-secret-32-characters";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", trustedOrigin);
  vi.stubEnv("BETTER_AUTH_SECRET", testSecret);
});

afterEach(() => vi.unstubAllEnvs());

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

function createMemoryRepository(): AddressRepository {
  const addresses: SavedAddress[] = [];

  return {
    async listByOwner(requestOwnerId) {
      return addresses.filter((address) => address.ownerId === requestOwnerId);
    },
    async findByOwner(requestOwnerId, addressId) {
      return addresses.find(
        (address) =>
          address.ownerId === requestOwnerId && address.id === addressId,
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
    async updateByOwner(requestOwnerId, addressId, input) {
      const index = addresses.findIndex(
        (address) =>
          address.ownerId === requestOwnerId && address.id === addressId,
      );
      if (index < 0) return null;

      const updated = { ...addresses[index], ...input, updatedAt: now };
      addresses[index] = updated;
      return updated;
    },
    async deleteByOwner(requestOwnerId, addressId) {
      const index = addresses.findIndex(
        (address) =>
          address.ownerId === requestOwnerId && address.id === addressId,
      );
      if (index < 0) return false;
      addresses.splice(index, 1);
      return true;
    },
  };
}

function requestWith(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/account/addresses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: trustedOrigin,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("/api/account/addresses", () => {
  it("returns the error contract with 401 before reading an unauthenticated request", async () => {
    const handlers = createAddressCollectionHandlers({
      requireSession: async () => {
        throw new HttpError("Unauthorized", 401);
      },
      repository: createMemoryRepository(),
    });
    const invalidJsonRequest = new Request(
      "http://localhost/api/account/addresses",
      { method: "POST", body: "{" },
    );

    const response = await handlers.POST(invalidJsonRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
  });

  it.each([
    ["country", { ...nzAddress, country: "US" }],
    ["postcode", { ...nzAddress, postcode: "101" }],
    ["region", { ...auAddress, region: "Auckland" }],
  ])("returns field errors for an invalid %s", async (field, input) => {
    const handlers = createAddressCollectionHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository(),
    });

    const response = await handlers.POST(requestWith(input));

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Address details are invalid",
        fields: { [field]: [expect.any(String)] },
      },
    });
  });

  it.each([
    [nzAddress, { country: "NZ", postcode: "1010", phone: "+64211234567" }],
    [
      auAddress,
      { country: "AU", region: "NSW", postcode: "2000", phone: "+61412345678" },
    ],
  ])("creates and lists an owner-scoped address", async (input, expected) => {
    const handlers = createAddressCollectionHandlers({
      requireSession: async () => ({ user: { id: ownerId } }),
      repository: createMemoryRepository(),
    });

    const createResponse = await handlers.POST(requestWith(input));

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await createResponse.json()).toMatchObject({
      address: { id: "address-1", ownerId, ...expected },
    });

    const listResponse = await handlers.GET();
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await listResponse.json()).toMatchObject({
      addresses: [{ id: "address-1", ownerId, ...expected }],
    });
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
    "rejects %s before creating an address",
    async (_name, headers, status, code) => {
      const repository = createMemoryRepository();
      const handlers = createAddressCollectionHandlers({
        requireSession: async () => ({ user: { id: ownerId } }),
        repository,
      });

      const response = await handlers.POST(requestWith(nzAddress, headers));

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });

      const listResponse = await handlers.GET();
      expect(await listResponse.json()).toEqual({ addresses: [] });
    },
  );
});
