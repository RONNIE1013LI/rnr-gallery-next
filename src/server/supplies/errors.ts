export class SuppliesSchemaPendingError extends Error {
  constructor() { super("Supplies database migration is pending; the store remains OFF."); this.name = "SuppliesSchemaPendingError"; }
}

export function isSuppliesSchemaPendingError(error: unknown): boolean {
  return error instanceof SuppliesSchemaPendingError;
}

export function isMissingSuppliesSchema(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth++) {
    if ("code" in candidate && candidate.code === "42P01") return true;
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
}
