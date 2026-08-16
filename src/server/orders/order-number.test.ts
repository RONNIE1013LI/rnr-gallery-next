import { describe, expect, it, vi } from "vitest";
import { allocateOrderNumber, formatOrderNumber } from "./order-number";

describe("numeric order numbers", () => {
  it.each([
    [8_000, "08000"],
    [8_001, "08001"],
    [99_999, "99999"],
    [100_000, "100000"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatOrderNumber(value)).toBe(expected);
  });

  it("allocates the next padded PostgreSQL sequence value", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ value: "08000" }] });
    await expect(allocateOrderNumber({ execute } as never)).resolves.toBe("08000");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fails closed for an invalid database value", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ value: "RNR-8000" }] });
    await expect(allocateOrderNumber({ execute } as never)).rejects.toThrow(
      "Order number allocation failed",
    );
  });
});
