import type { NormalizedAddress } from "@/domain/address/types";

export type CreateAddressInput = NormalizedAddress;

export type SavedAddress = Readonly<
  NormalizedAddress & {
    id: string;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  }
>;

export interface AddressRepository {
  listByOwner(ownerId: string): Promise<SavedAddress[]>;
  findByOwner(ownerId: string, addressId: string): Promise<SavedAddress | null>;
  create(ownerId: string, input: CreateAddressInput): Promise<SavedAddress>;
  updateByOwner(
    ownerId: string,
    addressId: string,
    input: CreateAddressInput,
  ): Promise<SavedAddress | null>;
  deleteByOwner(ownerId: string, addressId: string): Promise<boolean>;
}
