export type ProductionJobAuditChange = Readonly<{
  field: string;
  before?: string;
  after?: string;
}>;

type AuditValues = Readonly<Record<string, unknown>>;
type AuditItem = Readonly<Record<string, unknown>>;

const trackedFields = [
  "customerName", "customerEmail", "customerPhone", "assignedUserId", "urgent",
  "customerSource", "neededDate", "deliveryMethod", "deliveryAddress",
  "paymentReconciliationStatus", "designRequirements", "internalNotes", "manualStatus",
  "fileSentAt", "downloadedAt", "printedAt", "customerNotifiedAt", "deliveredAt",
  "artistPaidAt", "completedAt", "manualPaymentStatus", "amountPayableCents",
  "amountPaidCents", "artistFeeCents", "materialCostCents",
] as const;

const privateFields = new Set([
  "customerName", "customerEmail", "customerPhone", "assignedUserId",
  "deliveryAddress", "designRequirements", "internalNotes",
]);
const milestoneFields = new Set([
  "fileSentAt", "downloadedAt", "printedAt", "customerNotifiedAt",
  "deliveredAt", "artistPaidAt", "completedAt",
]);
const moneyFields = new Set([
  "amountPayableCents", "amountPaidCents", "artistFeeCents", "materialCostCents",
]);

function comparable(value: unknown) {
  return value instanceof Date ? value.toISOString() : value;
}

function display(field: string, value: unknown) {
  if (milestoneFields.has(field)) return value ? "YES" : "NO";
  if (moneyFields.has(field)) return `$${(Number(value ?? 0) / 100).toFixed(2)}`;
  if (typeof value === "boolean") return value ? "YES" : "NO";
  return String(value ?? "—").replaceAll("_", " ");
}

function canonicalItems(items: readonly AuditItem[]) {
  return JSON.stringify(items.map((item) => ({
    productTitle: item.productTitle,
    sizeLabel: item.sizeLabel,
    quantity: item.quantity,
    designText: item.designText,
    notes: item.notes,
  })));
}

export function productionJobAuditChanges(
  current: AuditValues,
  requested: AuditValues,
  currentItems: readonly AuditItem[] = [],
  requestedItems: readonly AuditItem[] | undefined = undefined,
): readonly ProductionJobAuditChange[] {
  const changes: ProductionJobAuditChange[] = [];
  for (const field of trackedFields) {
    if (!(field in requested) || requested[field] === undefined ||
      comparable(current[field]) === comparable(requested[field])) continue;
    changes.push(privateFields.has(field)
      ? { field }
      : { field, before: display(field, current[field]), after: display(field, requested[field]) });
  }
  if (requestedItems && canonicalItems(currentItems) !== canonicalItems(requestedItems)) {
    changes.push({ field: "items" });
  }
  return Object.freeze(changes);
}
