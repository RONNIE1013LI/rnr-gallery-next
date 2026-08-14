import type {
  OrderFulfilmentStatus,
  OrderPaymentStatus,
  ProductionDeliveryMethod,
} from "@/server/db/schema";

export type ProductionOperationsJob = Readonly<{
  id: string;
  jobNumber: string;
  source: "web" | "manual";
  orderNumber: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  status: OrderFulfilmentStatus;
  paymentStatus: OrderPaymentStatus;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: ProductionDeliveryMethod;
  assignedUserId: string | null;
  assignedUserName: string | null;
  productTitles: readonly string[];
  sizeLabels: readonly string[];
  finance: Readonly<{
    amountPayableCents: number;
    amountPaidCents: number;
    amountOwingCents: number;
    artistFeeCents: number | null;
    materialCostCents: number | null;
    actualProfitCents: number | null;
  }> | null;
  createdAt: Date;
  updatedAt: Date;
}>;

function localDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isActive(status: OrderFulfilmentStatus) {
  return status !== "completed" && status !== "cancelled";
}

export function buildProductionReport(
  jobs: readonly ProductionOperationsJob[],
  now = new Date(),
  permissions: Readonly<{ canViewFinance: boolean }>,
) {
  const today = localDate(now);
  const dueLimit = addDays(today, 2);
  const active = jobs.filter((job) => isActive(job.status));
  const overdue = active.filter((job) => job.neededDate < today);
  const dueSoon = active.filter((job) => job.neededDate >= today && job.neededDate <= dueLimit);
  const urgent = active.filter((job) => job.urgent);
  const unassigned = active.filter((job) => !job.assignedUserId);
  const statusCounts = Object.fromEntries(
    [...new Set(jobs.map((job) => job.status))].sort().map((status) => [status, jobs.filter((job) => job.status === status).length]),
  );
  const workloadMap = new Map<string, { assignedUserId: string; assignedUserName: string; activeJobs: number }>();
  for (const job of active) {
    if (!job.assignedUserId) continue;
    const current = workloadMap.get(job.assignedUserId);
    if (current) current.activeJobs += 1;
    else workloadMap.set(job.assignedUserId, { assignedUserId: job.assignedUserId, assignedUserName: job.assignedUserName ?? "Unknown", activeJobs: 1 });
  }
  const attention = active.map((job) => {
    const reasons: string[] = [];
    if (job.neededDate < today) reasons.push("Overdue");
    if (job.urgent) reasons.push("Urgent");
    if (job.neededDate >= today && job.neededDate <= dueLimit) reasons.push("Due within 2 days");
    if (!job.assignedUserId) reasons.push("Unassigned");
    const priority = job.neededDate < today ? 0 : job.urgent ? 1 : job.neededDate <= dueLimit ? 2 : 3;
    return { id: job.id, jobNumber: job.jobNumber, customerName: job.customerName, neededDate: job.neededDate, reasons, priority };
  }).filter((item) => item.reasons.length).sort((a, b) => a.priority - b.priority || a.neededDate.localeCompare(b.neededDate) || a.jobNumber.localeCompare(b.jobNumber));

  const finance = permissions.canViewFinance ? jobs.reduce((totals, job) => {
    if (!job.finance) return totals;
    const refunded = job.paymentStatus === "refunded";
    const cancelled = job.paymentStatus === "cancelled";
    const artistFeeCents = job.finance.artistFeeCents ?? 0;
    const materialCostCents = job.finance.materialCostCents ?? 0;
    const hasRecordedCosts = job.finance.artistFeeCents !== null || job.finance.materialCostCents !== null;
    const netPaidCents = refunded ? 0 : job.finance.amountPaidCents;
    return {
      payableCents: totals.payableCents + job.finance.amountPayableCents,
      paidCents: totals.paidCents + job.finance.amountPaidCents,
      refundedCents: totals.refundedCents + (refunded ? job.finance.amountPaidCents : 0),
      netCollectedCents: totals.netCollectedCents + netPaidCents,
      owingCents: totals.owingCents + (refunded || cancelled ? 0 : job.finance.amountOwingCents),
      artistFeeCents: totals.artistFeeCents + artistFeeCents,
      materialCostCents: totals.materialCostCents + materialCostCents,
      actualProfitCents: totals.actualProfitCents + (hasRecordedCosts
        ? netPaidCents - artistFeeCents - materialCostCents
        : job.finance.actualProfitCents ?? 0),
    };
  }, {
    payableCents: 0,
    paidCents: 0,
    refundedCents: 0,
    netCollectedCents: 0,
    owingCents: 0,
    artistFeeCents: 0,
    materialCostCents: 0,
    actualProfitCents: 0,
  }) : null;

  return Object.freeze({
    generatedAt: now,
    metrics: Object.freeze({ total: jobs.length, active: active.length, overdue: overdue.length, dueSoon: dueSoon.length, urgent: urgent.length, unassigned: unassigned.length }),
    statusCounts: Object.freeze(statusCounts),
    workload: Object.freeze([...workloadMap.values()].sort((a, b) => b.activeJobs - a.activeJobs || a.assignedUserName.localeCompare(b.assignedUserName)).map((item) => Object.freeze(item))),
    attention: Object.freeze(attention.slice(0, 100).map((item) => Object.freeze({
      id: item.id,
      jobNumber: item.jobNumber,
      customerName: item.customerName,
      neededDate: item.neededDate,
      reasons: Object.freeze(item.reasons),
    }))),
    finance: finance ? Object.freeze(finance) : null,
  });
}

function csvCell(value: unknown) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createProductionCsv(jobs: readonly ProductionOperationsJob[]) {
  const headers = ["Job number", "Source", "Order number", "Customer", "Email", "Phone", "Products", "Sizes", "Status", "Payment", "Urgent", "Needed date", "Delivery", "Assigned", "Payable NZD", "Paid NZD", "Owing NZD", "Created", "Updated"];
  const rows = jobs.slice(0, 5_000).map((job) => [
    job.jobNumber, job.source, job.orderNumber, job.customerName, job.customerEmail, job.customerPhone,
    job.productTitles.join(" | "), job.sizeLabels.join(" | "), job.status, job.paymentStatus,
    job.urgent ? "Yes" : "No", job.neededDate, job.deliveryMethod, job.assignedUserName,
    job.finance ? (job.finance.amountPayableCents / 100).toFixed(2) : "",
    job.finance ? (job.finance.amountPaidCents / 100).toFixed(2) : "",
    job.finance ? (job.finance.amountOwingCents / 100).toFixed(2) : "",
    job.createdAt, job.updatedAt,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
