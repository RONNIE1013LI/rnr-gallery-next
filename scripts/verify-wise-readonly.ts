// Local-only diagnostic: token flows from macOS Keychain to fixed-origin GET requests in memory.
import { execFileSync } from "node:child_process";
import { createWiseReadOnlyClient, WiseReadError } from "../src/server/payments/wise-readonly-client";
import { parseWiseStatement } from "../src/server/payments/wise-payid-matching";
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
async function main() {
  let token: string;
  try { token = execFileSync("/usr/bin/security", ["find-generic-password", "-s", "co.nz.rrgallery.wise.readonly", "-a", "aud-reconciliation", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim(); }
  catch { console.log(JSON.stringify({ status: "keychain_unavailable" })); return; }
  const client = createWiseReadOnlyClient(token);
  token = "";
  const profiles = await client.profiles();
  if (!Array.isArray(profiles)) throw new WiseReadError("invalid");
  const businesses = profiles.map(record).filter((p) => String(p.type).toUpperCase() === "BUSINESS");
  console.log(JSON.stringify({ step: "business_profiles", profiles: businesses.map((p) => ({ id: p.id, name: p.businessName ?? p.fullName ?? record(p.details).name ?? p.name, fields: Object.keys(p) })) }));
  const selected = businesses.filter((p) => /r\s*&\s*r\s*gallery/i.test(String(p.businessName ?? p.fullName ?? record(p.details).name ?? p.name ?? "")));
  if (selected.length !== 1 || typeof selected[0].id !== "number") { console.log(JSON.stringify({ status: "business_profile_selection_required" })); return; }
  const profileId = selected[0].id;
  const balances = await client.balances(profileId);
  if (!Array.isArray(balances)) throw new WiseReadError("invalid");
  const aud = balances.map(record).filter((b) => b.currency === "AUD" && b.type === "STANDARD");
  if (aud.length !== 1 || typeof aud[0].id !== "number") { console.log(JSON.stringify({ status: "aud_balance_selection_required" })); return; }
  const balanceId = aud[0].id;
  console.log(JSON.stringify({ step: "aud_balance", profileId, balanceId, investmentState: aud[0].investmentState }));
  const end = new Date();
  const payload = await client.statement(profileId, balanceId, new Date(end.getTime() - 30 * 86400_000), end);
  const root = record(payload);
  const rows = Array.isArray(root.transactions) ? root.transactions.map(record) : [];
  const credits = rows.filter((t) => t.type === "CREDIT");
  console.log(JSON.stringify({ step: "statement", transactionCount: rows.length, credits: credits.length, query: record(root.query),
    creditFieldNames: [...new Set(credits.flatMap((r) => Object.keys(r)))], detailFieldNames: [...new Set(credits.flatMap((r) => Object.keys(record(r.details))))],
    hasAmountCurrency: credits.filter((r) => typeof record(r.amount).value === "number" && record(r.amount).currency === "AUD").length,
    hasTransactionId: credits.filter((r) => typeof r.referenceNumber === "string").length,
    hasPayer: credits.filter((r) => typeof record(r.details).senderName === "string").length,
    hasPaymentReference: credits.filter((r) => Boolean(record(r.details).paymentReference)).length,
    zeroFees: credits.filter((r) => record(r.totalFees).value === 0).length,
    noExchange: credits.filter((r) => !r.exchangeDetails).length,
    exchangeFieldTypes: credits.map((r) => r.exchangeDetails === null ? "null" : typeof r.exchangeDetails),
    explicitlyNamesPayIdOrNpp: credits.filter((r) => /payid|osko|npp/i.test(String(record(r.details).description ?? ""))).length,
    detailTypes: [...new Set(credits.map((r) => record(r.details).type))],
    referenceShapes: credits.map((r) => { const ref = record(r.details).paymentReference; return { present: typeof ref === "string" && ref.length > 0, length: typeof ref === "string" ? ref.length : 0, format: typeof ref === "string" && /^RRA[0-9A-F]{16}$/.test(ref) ? "new_payid_reference" : "other_or_absent" }; }),
  }));
  try { const parsed = parseWiseStatement(payload, balanceId, profileId); console.log(JSON.stringify({ step: "parser", status: "pass", eligibleCredits: parsed.filter((r) => r.eligible).length, payidReferenceRoundTrip: "UNKNOWN: existing deposits do not prove the new order reference round trip" })); }
  catch { console.log(JSON.stringify({ step: "parser", status: "shape_or_identity_rejected" })); }
  try { const subscriptions = await client.subscriptions(profileId); console.log(JSON.stringify({ step: "webhook_list", status: "readable", count: Array.isArray(subscriptions) ? subscriptions.length : undefined, creationCapability: "UNKNOWN: no write attempted" })); }
  catch (error) { console.log(JSON.stringify({ step: "webhook_list", status: error instanceof WiseReadError ? error.status ?? error.code : "unavailable" })); }
}
main().catch((error) => { console.log(JSON.stringify({ status: "read_failed", code: error instanceof WiseReadError ? error.code : "invalid", httpStatus: error instanceof WiseReadError ? error.status : undefined })); process.exitCode = 1; });
