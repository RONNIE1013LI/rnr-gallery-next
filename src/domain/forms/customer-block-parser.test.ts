import { describe, expect, it } from "vitest";
import { parseCustomerBlock } from "./customer-block-parser";

describe("customer block parser", () => {
  it("extracts the supplied NZ customer block", () => {
    expect(parseCustomerBlock(`Litea Murtagh
2/6 Ryburn Road, Mount Wellington, Auckland 1062
027-7199394
Liteamurtagh@live.com`)).toEqual({
      customerName: "Litea Murtagh",
      customerEmail: "liteamurtagh@live.com",
      customerPhone: "+64277199394",
      deliveryAddress: "2/6 Ryburn Road, Mount Wellington, Auckland 1062",
      country: "NZ",
    });
  });

  it("preserves explicit NZ and AU international numbers", () => {
    expect(parseCustomerBlock("Ana Example\n1 Queen Street\n+64 21 123 4567\nana@example.com").customerPhone)
      .toBe("+64211234567");
    expect(parseCustomerBlock("Sam Example\n8 George Street Sydney NSW 2000\n+61 412 345 678\nsam@example.com").customerPhone)
      .toBe("+61412345678");
  });

  it("uses Australia shipping for a local AU mobile", () => {
    const result = parseCustomerBlock(
      "Sam Example\n8 George Street, Sydney 2000\n0412 345 678\nsam@example.com",
      "australia_shipping",
    );
    expect(result.country).toBe("AU");
    expect(result.customerPhone).toBe("+61412345678");
  });

  it("leaves invalid and ambiguous content in the address", () => {
    expect(parseCustomerBlock("2/6 Ryburn Road\nPhone tomorrow")).toEqual({
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      deliveryAddress: "2/6 Ryburn Road\nPhone tomorrow",
      country: "NZ",
    });
  });
});
