import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import { user } from "@/server/db/schema";
import { createDrizzleAddressRepository } from "./drizzle-address-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const ownerIds = ["address-owner-a", "address-owner-b"];
const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const repository = createDrizzleAddressRepository(database);

const nzAddress: NormalizedAddress = {
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

const auAddress: NormalizedAddress = {
  country: "AU",
  fullName: "Mia Chen",
  building: "Level 2",
  street: "55 George Street",
  suburb: "Sydney",
  region: "NSW",
  postcode: "2000",
  phone: "+61412345678",
  email: "mia@example.test",
};

describe("Drizzle address repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      {
        id: ownerIds[0],
        name: "Address Owner A",
        email: "address-owner-a@example.test",
      },
      {
        id: ownerIds[1],
        name: "Address Owner B",
        email: "address-owner-b@example.test",
      },
    ]);
  });

  afterAll(async () => {
    await database.delete(user).where(inArray(user.id, ownerIds));
    await pool.end();
  });

  it("creates and lists addresses only for their owner", async () => {
    const created = await repository.create(ownerIds[0], nzAddress);

    expect(created).toMatchObject({ ownerId: ownerIds[0], ...nzAddress });
    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    expect(await repository.findByOwner(ownerIds[0], created.id)).toMatchObject(
      nzAddress,
    );
    expect(await repository.findByOwner(ownerIds[1], created.id)).toBeNull();
    expect(await repository.listByOwner(ownerIds[0])).toEqual([created]);
    expect(await repository.listByOwner(ownerIds[1])).toEqual([]);
  });

  it("treats foreign-owned addresses as missing during update and delete", async () => {
    const created = await repository.create(ownerIds[0], nzAddress);

    expect(
      await repository.updateByOwner(ownerIds[1], created.id, auAddress),
    ).toBeNull();
    expect(await repository.deleteByOwner(ownerIds[1], created.id)).toBe(false);
    expect(await repository.findByOwner(ownerIds[0], created.id)).toMatchObject(
      nzAddress,
    );
  });

  it("allows the owner to update and delete their address", async () => {
    const created = await repository.create(ownerIds[0], nzAddress);

    const updated = await repository.updateByOwner(
      ownerIds[0],
      created.id,
      auAddress,
    );

    expect(updated).toMatchObject({
      id: created.id,
      ownerId: ownerIds[0],
      ...auAddress,
    });
    expect(await repository.deleteByOwner(ownerIds[0], created.id)).toBe(true);
    expect(await repository.findByOwner(ownerIds[0], created.id)).toBeNull();
  });
});
