import { createHash } from "node:crypto";

export type WiseCredit = Readonly<{
  transactionId: string; amountCents: number | null; currency: string; reference: string | null;
  payerName: string | null; receivedAt: Date; eligible: boolean; digest: string; isCredit: boolean;
}>;
export type WiseIntent = Readonly<{ id: string; reference: string; amountCents: number; currency: string; createdAt: Date; status: string }>;
export type WiseMatch = { kind: "matched"; intentId: string } | { kind: "review"; reason: string };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Wise statement");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const raw = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimals = ""] = raw.replace(/^-/, "").split(".");
  const result = (Number(whole) * 100 + Number(decimals.padEnd(2, "0"))) * (value < 0 ? -1 : 1);
  return Number.isSafeInteger(result) ? result : null;
}
// No fuzzy reference/description/payer-name matching. Field mapping still needs real PayID receipt validation.
export function parseWiseStatement(payload: unknown, balanceId: number, profileId?: number): readonly WiseCredit[] {
  const statement = object(payload);
  const query = object(statement.query);
  if ((query.accountId !== undefined && query.accountId !== balanceId) || (profileId !== undefined && query.profileId !== profileId) ||
    (query.accountId === undefined && profileId === undefined) || query.currency !== "AUD" || !Array.isArray(statement.transactions)) throw new Error("Wise statement identity mismatch");
  const seen = new Map<string, string>();
  return statement.transactions.map((value): WiseCredit => {
    const row = object(value);
    const amount = object(row.amount);
    const details = object(row.details);
    const fees = object(row.totalFees);
    const transactionId = text(row.referenceNumber, 200) ?? "";
    const receivedAt = new Date(typeof row.date === "string" ? row.date : "");
    if (!Number.isFinite(receivedAt.getTime())) throw new Error("Invalid Wise transaction date");
    const reference = text(details.paymentReference, 200);
    const payerName = text(details.senderName, 200);
    const amountCents = cents(amount.value);
    const currency = text(amount.currency, 3) ?? "";
    const eligible = row.type === "CREDIT" && details.type === "DEPOSIT" && Boolean(transactionId) &&
      currency === "AUD" && amountCents !== null && amountCents > 0 && fees.currency === "AUD" && fees.value === 0 && !row.exchangeDetails;
    const digest = createHash("sha256").update(JSON.stringify([transactionId, row.type, row.date, amount.value, amount.currency,
      fees.value, fees.currency, details.type, details.paymentReference ?? null, details.senderName ?? null, row.exchangeDetails ?? null])).digest("hex");
    if (transactionId && seen.has(transactionId) && seen.get(transactionId) !== digest) throw new Error("Conflicting Wise transaction identity");
    if (transactionId) seen.set(transactionId, digest);
    return { transactionId, amountCents, currency, reference, payerName, receivedAt, eligible, digest, isCredit: row.type === "CREDIT" };
  });
}
export function matchWiseCredit(credit: WiseCredit, intents: readonly WiseIntent[]): WiseMatch {
  if (!credit.eligible || !credit.transactionId || credit.currency !== "AUD" || credit.amountCents === null) return { kind: "review", reason: "unsupported_credit" };
  if (!credit.reference) return { kind: "review", reason: "missing_reference" };
  const candidates = intents.filter((intent) => intent.reference === credit.reference);
  if (candidates.length !== 1) return { kind: "review", reason: candidates.length > 1 ? "ambiguous_reference" : "unknown_reference" };
  const intent = candidates[0];
  if (intent.currency !== "AUD" || intent.amountCents !== credit.amountCents) return { kind: "review", reason: "amount_currency_mismatch" };
  if (credit.receivedAt < intent.createdAt) return { kind: "review", reason: "predates_order" };
  if (credit.receivedAt.getTime() > intent.createdAt.getTime() + 30 * 86400_000) return { kind: "review", reason: "outside_payment_window" };
  if (intent.status !== "pending") return { kind: "review", reason: "order_not_pending" };
  return { kind: "matched", intentId: intent.id };
}
