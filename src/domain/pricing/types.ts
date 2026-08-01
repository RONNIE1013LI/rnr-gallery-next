export type PriceLine = Readonly<{
  key: string;
  label: string;
  amountExGstCents: number;
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
