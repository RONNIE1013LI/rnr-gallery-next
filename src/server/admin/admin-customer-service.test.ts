import { describe, expect, it, vi } from "vitest";
import { listAdminCustomers } from "./admin-customer-service";

describe("listAdminCustomers", () => {
  it("delegates filtering and pagination to PostgreSQL", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total: "61" }] })
      .mockResolvedValueOnce({ rows: [{
        key: "customer-31",
        accountId: "customer-31",
        name: "Thirty One",
        email: "thirty-one@example.test",
        registered: true,
        emailVerified: true,
        phone: "0210000031",
        country: "NZ",
        defaultAddress: "31 Test Street, Auckland, 1010, NZ",
        orderCount: "2",
        paidSpentInclGstCents: "46000",
        lastOrderAt: "2026-08-05T00:00:00.000Z",
      }] });
    const database = { execute } as never;

    await expect(listAdminCustomers(database, { q: " Thirty ", page: "2" }))
      .resolves.toEqual({
        items: [expect.objectContaining({
          key: "customer-31",
          orderCount: 2,
          paidSpentInclGstCents: 46_000,
          lastOrderAt: new Date("2026-08-05T00:00:00.000Z"),
        })],
        total: 61,
        page: 2,
        pageSize: 30,
        pageCount: 3,
      });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
