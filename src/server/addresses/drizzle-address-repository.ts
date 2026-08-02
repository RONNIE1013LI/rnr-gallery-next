import { and, eq } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { customerAddresses } from "@/server/db/schema";
import type {
  AddressRepository,
  CreateAddressInput,
  SavedAddress,
} from "./address-repository";

type Database = ReturnType<typeof getDatabase>;

function addressValues(input: CreateAddressInput) {
  return {
    country: input.country,
    fullName: input.fullName,
    building: input.building,
    street: input.street,
    suburb: input.suburb,
    region: input.region,
    postcode: input.postcode,
    phone: input.phone,
    email: input.email,
  };
}

export function createDrizzleAddressRepository(
  database: Database,
): AddressRepository {
  return {
    async listByOwner(ownerId) {
      return database
        .select()
        .from(customerAddresses)
        .where(eq(customerAddresses.ownerId, ownerId));
    },

    async findByOwner(ownerId, addressId) {
      const [address] = await database
        .select()
        .from(customerAddresses)
        .where(
          and(
            eq(customerAddresses.id, addressId),
            eq(customerAddresses.ownerId, ownerId),
          ),
        )
        .limit(1);

      return address ?? null;
    },

    async create(ownerId, input: CreateAddressInput): Promise<SavedAddress> {
      const [created] = await database
        .insert(customerAddresses)
        .values({ ownerId, ...addressValues(input) })
        .returning();

      return created;
    },

    async updateByOwner(ownerId, addressId, input) {
      const [updated] = await database
        .update(customerAddresses)
        .set({ ...addressValues(input), updatedAt: new Date() })
        .where(
          and(
            eq(customerAddresses.id, addressId),
            eq(customerAddresses.ownerId, ownerId),
          ),
        )
        .returning();

      return updated ?? null;
    },

    async deleteByOwner(ownerId, addressId) {
      const deleted = await database
        .delete(customerAddresses)
        .where(
          and(
            eq(customerAddresses.id, addressId),
            eq(customerAddresses.ownerId, ownerId),
          ),
        )
        .returning({ id: customerAddresses.id });

      return deleted.length > 0;
    },
  };
}
