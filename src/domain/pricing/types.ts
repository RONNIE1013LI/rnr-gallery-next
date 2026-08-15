export type PriceLine = Readonly<{
  key: string;
  label: string;
  amountExGstCents: number;
  amountInclGstCents?: number;
}>;

export type PriceBreakdown = Readonly<{
  lines: readonly PriceLine[];
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
}>;

export class InvalidPricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPricingInputError";
  }
}

export function assertIntegerCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidPricingInputError(
      `${label} must be a non-negative integer number of cents.`,
    );
  }
}

export function getPriceLineAmountInclGstCents(line: PriceLine): number {
  if (line.amountInclGstCents !== undefined) {
    assertIntegerCents(line.amountInclGstCents, line.label);
    return line.amountInclGstCents;
  }

  assertIntegerCents(line.amountExGstCents, line.label);
  return Math.round((line.amountExGstCents * 115) / 100);
}

export function createPriceBreakdown(
  lines: readonly PriceLine[],
): PriceBreakdown {
  const subtotalExGstCents = lines.reduce(
    (total, line) => total + line.amountExGstCents,
    0,
  );
  const gstCents = Math.round((subtotalExGstCents * 15) / 100);

  return Object.freeze({
    lines: Object.freeze([...lines]),
    subtotalExGstCents,
    gstCents,
    totalInclGstCents: subtotalExGstCents + gstCents,
  });
}

export function addTaxInclusivePriceLine(
  breakdown: PriceBreakdown,
  line: Readonly<{ key: string; label: string; amountInclGstCents: number }>,
): PriceBreakdown {
  assertIntegerCents(line.amountInclGstCents, line.label);
  const amountExGstCents = Math.round((line.amountInclGstCents * 100) / 115);
  const gstCents = line.amountInclGstCents - amountExGstCents;
  const priceLine = Object.freeze({ ...line, amountExGstCents });

  return Object.freeze({
    lines: Object.freeze([...breakdown.lines, priceLine]),
    subtotalExGstCents: breakdown.subtotalExGstCents + amountExGstCents,
    gstCents: breakdown.gstCents + gstCents,
    totalInclGstCents: breakdown.totalInclGstCents + line.amountInclGstCents,
  });
}
