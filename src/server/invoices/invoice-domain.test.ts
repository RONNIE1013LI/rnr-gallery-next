import { describe, expect, it } from "vitest";
import {
  InvoiceValidationError,
  buildInvoiceNumber,
  calculateInvoiceTotals,
  parseInvoiceDraft,
} from "./invoice-domain";

const draft = {
  invoiceDate: "2026-08-05",
  dueDate: "2026-08-12",
  reference: "WEB-1042",
  customerName: "Ana Example",
  customerEmail: "ana@example.com",
  customerAddress: "11 Example Street\nAuckland 0632",
  deliveryAddress: "11 Example Street\nAuckland 0632",
  discountCents: 0,
  notes: "Thank you for your order.",
  terms: "Payment is due by the date shown.",
  items: [{
    code: "CANVAS-A4",
    description: "Digital Oil Painting Canvas — A4",
    quantityMilli: 1_000,
    rateInclGstCents: 23_000,
  }],
};

describe("invoice totals", () => {
  it.each([
    {
      name: "one tax-inclusive item",
      items: [{ quantityMilli: 1_000, rateInclGstCents: 23_000 }],
      discountCents: 0,
      expected: {
        grossCents: 23_000,
        discountCents: 0,
        subtotalExGstCents: 20_000,
        gstCents: 3_000,
        totalInclGstCents: 23_000,
      },
    },
    {
      name: "multiple lines and discount",
      items: [
        { quantityMilli: 2_000, rateInclGstCents: 5_750 },
        { quantityMilli: 1_000, rateInclGstCents: 11_500 },
      ],
      discountCents: 2_300,
      expected: {
        grossCents: 23_000,
        discountCents: 2_300,
        subtotalExGstCents: 18_000,
        gstCents: 2_700,
        totalInclGstCents: 20_700,
      },
    },
    {
      name: "fractional quantity",
      items: [{ quantityMilli: 1_500, rateInclGstCents: 11_500 }],
      discountCents: 0,
      expected: {
        grossCents: 17_250,
        discountCents: 0,
        subtotalExGstCents: 15_000,
        gstCents: 2_250,
        totalInclGstCents: 17_250,
      },
    },
    {
      name: "rounding boundary",
      items: [{ quantityMilli: 1_000, rateInclGstCents: 100 }],
      discountCents: 0,
      expected: {
        grossCents: 100,
        discountCents: 0,
        subtotalExGstCents: 87,
        gstCents: 13,
        totalInclGstCents: 100,
      },
    },
    {
      name: "zero after discount",
      items: [{ quantityMilli: 1_000, rateInclGstCents: 5_000 }],
      discountCents: 5_000,
      expected: {
        grossCents: 5_000,
        discountCents: 5_000,
        subtotalExGstCents: 0,
        gstCents: 0,
        totalInclGstCents: 0,
      },
    },
  ])("calculates $name", ({ items, discountCents, expected }) => {
    expect(calculateInvoiceTotals({ items, discountCents })).toEqual(expected);
  });
});

describe("invoice draft validation", () => {
  it("normalizes a strict draft", () => {
    expect(parseInvoiceDraft({
      ...draft,
      customerName: "  Ana Example ",
      items: [{ ...draft.items[0], description: "  Digital Canvas  " }],
    })).toMatchObject({
      customerName: "Ana Example",
      items: [{ description: "Digital Canvas" }],
    });
  });

  it.each([
    { ...draft, invoiceDate: "2026-02-31" },
    { ...draft, dueDate: "2026-08-01" },
    { ...draft, customerName: "" },
    { ...draft, discountCents: 23_001 },
    { ...draft, items: [] },
    { ...draft, items: [{ ...draft.items[0], quantityMilli: 0 }] },
    { ...draft, items: [{ ...draft.items[0], rateInclGstCents: -1 }] },
    { ...draft, unexpected: true },
  ])("rejects invalid or untrusted draft data", (input) => {
    expect(() => parseInvoiceDraft(input)).toThrow(InvoiceValidationError);
  });
});

describe("invoice number", () => {
  it("uses a stable, printable reference", () => {
    expect(buildInvoiceNumber("RRM-2026-ABC123")).toBe("INV-RRM-2026-ABC123");
  });

  it("rejects unsafe references", () => {
    expect(() => buildInvoiceNumber("../../bad")).toThrow(InvoiceValidationError);
  });
});
