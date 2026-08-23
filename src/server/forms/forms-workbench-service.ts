import { FORM_LIST_COLUMNS } from "@/domain/forms/forms-parity";

export type FormFilterCondition = Readonly<{
  field: FormFilterField;
  operator: FormFilterOperator;
  value: string | readonly string[];
}>;

export type FormFilterField =
  | "submittedAt"
  | "updatedAt"
  | "reference"
  | "productTitle"
  | "size"
  | "paymentProof"
  | "amountPayable"
  | "amountPaid"
  | "amountOwing"
  | "urgent"
  | "neededDate"
  | "deliveryMethod"
  | "deliveryAddress"
  | "customerSource"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "status"
  | "paymentStatus"
  | "assignedUserId"
  | "submittedByUserId"
  | "bankRecon"
  | "remark"
  | "designText"
  | "fileSent"
  | "downloaded"
  | "printed"
  | "completed"
  | "customerNotified"
  | "delivered"
  | "artistFee"
  | "materialCost"
  | `custom:${string}`;

export type FormFilterOperator =
  | "equals"
  | "notEquals"
  | "before"
  | "after"
  | "between"
  | "contains"
  | "greaterThan"
  | "lessThan"
  | "isEmpty"
  | "isNotEmpty";

export type FormFilterGroup = Readonly<{
  match: "and" | "or";
  conditions: readonly FormFilterCondition[];
}>;

const dateFields = new Set<FormFilterField>(["submittedAt", "updatedAt", "neededDate"]);
const numberFields = new Set<FormFilterField>(["amountPayable", "amountPaid", "amountOwing", "artistFee", "materialCost"]);
const booleanFields = new Set<FormFilterField>(["urgent", "paymentProof", "fileSent", "downloaded", "printed", "completed", "customerNotified", "delivered"]);
const textFields = new Set<FormFilterField>(["reference", "productTitle", "size", "deliveryAddress", "customerName", "customerEmail", "customerPhone", "remark", "designText"]);
const choiceFields = new Set<FormFilterField>(["deliveryMethod", "customerSource", "status", "paymentStatus", "assignedUserId", "submittedByUserId", "bankRecon"]);
const customFieldPattern = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const customOperators: readonly FormFilterOperator[] = ["contains", "equals", "notEquals", "before", "after", "between", "greaterThan", "lessThan", "isEmpty", "isNotEmpty"];

function operatorsFor(field: FormFilterField): readonly FormFilterOperator[] {
  if (dateFields.has(field)) return ["equals", "before", "after", "between", "isEmpty", "isNotEmpty"];
  if (numberFields.has(field)) return ["equals", "greaterThan", "lessThan", "between", "isEmpty", "isNotEmpty"];
  if (booleanFields.has(field)) return ["equals"];
  if (textFields.has(field)) return ["contains", "equals", "notEquals", "isEmpty", "isNotEmpty"];
  if (choiceFields.has(field)) return ["equals", "notEquals", "isEmpty", "isNotEmpty"];
  return customOperators;
}

function recognizedField(value: string): value is FormFilterField {
  return customFieldPattern.test(value) || dateFields.has(value as FormFilterField) ||
    numberFields.has(value as FormFilterField) || booleanFields.has(value as FormFilterField) ||
    textFields.has(value as FormFilterField) || choiceFields.has(value as FormFilterField);
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class FormFilterValidationError extends Error {
  constructor(message = "Order filter data is invalid") {
    super(message);
    this.name = "FormFilterValidationError";
  }
}

function validDate(value: string) {
  return datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function conditionFrom(input: unknown): FormFilterCondition {
  if (!input || typeof input !== "object") throw new FormFilterValidationError();
  const source = input as Record<string, unknown>;
  if (typeof source.field !== "string" || !recognizedField(source.field)) {
    throw new FormFilterValidationError("Unknown order filter field");
  }
  const field = source.field as FormFilterField;
  if (typeof source.operator !== "string" || !operatorsFor(field).includes(source.operator as FormFilterOperator)) {
    throw new FormFilterValidationError("Unsupported order filter operator");
  }
  const operator = source.operator as FormFilterOperator;
  const raw = source.value;
  if (operator === "isEmpty" || operator === "isNotEmpty") return Object.freeze({ field, operator, value: "" });
  const values = Array.isArray(raw) ? raw : [raw];
  if (values.some((value) => typeof value !== "string" || !value.trim() || value.length > 255)) {
    throw new FormFilterValidationError("Order filter value is invalid");
  }
  const normalized = (values as string[]).map((value) => value.trim());
  const customField = field.startsWith("custom:");
  if (booleanFields.has(field) && !["true", "false"].includes(normalized[0])) {
    throw new FormFilterValidationError("Boolean filter must be true or false");
  }
  if (dateFields.has(field) || (customField && ["before", "after"].includes(operator))) {
    if (operator === "between" ? normalized.length !== 2 : normalized.length !== 1) {
      throw new FormFilterValidationError("Date range is incomplete");
    }
    if (!normalized.every(validDate)) throw new FormFilterValidationError("Date filter is invalid");
  } else if (numberFields.has(field) || (customField && ["greaterThan", "lessThan"].includes(operator))) {
    if (operator === "between" ? normalized.length !== 2 : normalized.length !== 1) {
      throw new FormFilterValidationError("Number range is incomplete");
    }
    if (!normalized.every((value) => /^\d+(?:\.\d{1,2})?$/.test(value))) {
      throw new FormFilterValidationError("Number filter is invalid");
    }
  } else if (customField && operator === "between") {
    if (normalized.length !== 2 || (!normalized.every(validDate) && !normalized.every((value) => /^\d+(?:\.\d{1,2})?$/.test(value)))) {
      throw new FormFilterValidationError("Custom range is invalid");
    }
  } else if (normalized.length !== 1) {
    throw new FormFilterValidationError("Order filter has too many values");
  }
  return Object.freeze({
    field,
    operator,
    value: operator === "between" ? Object.freeze(normalized) : normalized[0],
  });
}

export function parseFormFilterGroup(input: unknown): FormFilterGroup {
  if (!input || typeof input !== "object") throw new FormFilterValidationError();
  const source = input as Record<string, unknown>;
  const match = source.match === "or" ? "or" : source.match === "and" ? "and" : null;
  if (!match || !Array.isArray(source.conditions) || source.conditions.length > 20) {
    throw new FormFilterValidationError();
  }
  return Object.freeze({
    match,
    conditions: Object.freeze(source.conditions.map(conditionFrom)),
  });
}

export function encodeFormFilterCondition(condition: FormFilterCondition) {
  const value = typeof condition.value === "string"
    ? condition.value
    : condition.value.join(",");
  return [condition.field, condition.operator, value].map(encodeURIComponent).join("~");
}

function decodeFormFilterCondition(value: string) {
  const [rawField, rawOperator, rawValue, extra] = value.split("~");
  if (!rawField || !rawOperator || rawValue === undefined || extra !== undefined) {
    throw new FormFilterValidationError();
  }
  const field = decodeURIComponent(rawField);
  const operator = decodeURIComponent(rawOperator);
  const decodedValue = decodeURIComponent(rawValue);
  return conditionFrom({
    field,
    operator,
    value: operator === "between" ? decodedValue.split(",") : decodedValue,
  });
}

export type FormWorkbenchQuery = Readonly<{
  query: string;
  page: number;
  pageSize: 20 | 50 | 100;
  match: "and" | "or";
  sort: "submittedAt" | "updatedAt" | "neededDate" | "reference";
  direction: "asc" | "desc";
  preset: "all" | "lastSixMonths" | "lastYear";
  conditions: readonly FormFilterCondition[];
}>;

export type FormOrderRow = Readonly<{
  id: string;
  source: "web" | "manual";
  version: string;
  submittedAt: string;
  reference: string;
  webOrderNumber: string;
  size: string;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: string;
  customerSource: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedUserId: string | null;
  artistName: string;
  status: string;
  paymentStatus: string;
  milestones: Readonly<{
    fileSent: boolean;
    downloaded: boolean;
    customerNotified: boolean;
    printed: boolean;
    completed: boolean;
    delivered: boolean;
  }>;
  bankRecon: string | null;
  finance: null | Readonly<{
    amountOwingCents: number;
    amountPaidCents: number;
    amountPayableCents: number;
    artistFeeCents: number | null;
  }>;
  remark: string;
  submittedBy: string;
}>;

export type FormWorkbenchResult = Readonly<{
  items: readonly FormOrderRow[];
  total: number;
  page: number;
  pageSize: 20 | 50 | 100;
  pageCount: number;
}>;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFormWorkbenchQuery(
  input: Readonly<Record<string, string | string[] | undefined>>,
): FormWorkbenchQuery {
  const rawPage = Number(scalar(input.page));
  const rawPageSize = Number(scalar(input.perPage));
  const pageSize: 20 | 50 | 100 = rawPageSize === 20
    ? 20
    : rawPageSize === 50
      ? 50
      : 100;
  const match = scalar(input.match) === "or" ? "or" : "and";
  const rawSort = scalar(input.sort);
  const sort = rawSort === "updatedAt" || rawSort === "neededDate" || rawSort === "reference"
    ? rawSort
    : "submittedAt";
  const direction = scalar(input.direction) === "asc" ? "asc" : "desc";
  const rawPreset = scalar(input.preset);
  const preset = rawPreset === "lastSixMonths" || rawPreset === "lastYear"
    ? rawPreset
    : "all";
  const rawFilters = (Array.isArray(input.filter) ? input.filter : input.filter ? [input.filter] : [])
    .slice(0, 20);
  const conditions = rawFilters.flatMap((value) => {
    try {
      return [decodeFormFilterCondition(value)];
    } catch {
      return [];
    }
  });
  return Object.freeze({
    query: (scalar(input.q) ?? "").trim().slice(0, 190),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize,
    match,
    sort,
    direction,
    preset,
    conditions: Object.freeze(conditions),
  });
}

export function visibleFormColumns(
  access: Readonly<{ canViewFinance: boolean }>,
) {
  return Object.freeze(FORM_LIST_COLUMNS.filter(
    (column) => access.canViewFinance || !("finance" in column && column.finance),
  ));
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createFormsCsv(
  rows: readonly FormOrderRow[],
  access: Readonly<{ canViewFinance: boolean; canViewCustomerContact: boolean }>,
) {
  const headers = [
    "Submitted Time", "Ref No.", "Web Order No.", "Size", "Urgent?",
    "DlvryDate", "DlvryMethod", "Customer Source", "Cust.Name",
    ...(access.canViewCustomerContact ? ["Email", "PhoneNo."] : []),
    "Artist", "Status", "Payment", "File Sent", "Download",
    "Customer Notified", "Printed", "Completed", "Delivered",
    ...(access.canViewFinance ? ["BankRecon", "AmtOwe", "AmtPaid", "AmtPayable", "Artist's Fee"] : []),
    "Remark", "Submitted By",
  ];
  const values = rows.slice(0, 5_000).map((row) => [
    row.submittedAt, row.reference, row.webOrderNumber, row.size,
    row.urgent ? "Urgent" : "Normal", row.neededDate, row.deliveryMethod,
    row.customerSource, row.customerName,
    ...(access.canViewCustomerContact ? [row.customerEmail, row.customerPhone] : []),
    row.artistName, row.status, row.paymentStatus,
    row.milestones.fileSent ? "YES" : "NO",
    row.milestones.downloaded ? "YES" : "NO",
    row.milestones.customerNotified ? "YES" : "NO",
    row.milestones.printed ? "YES" : "NO",
    row.milestones.completed ? "YES" : "NO",
    row.milestones.delivered ? "YES" : "NO",
    ...(access.canViewFinance ? [
      row.bankRecon,
      row.finance ? (row.finance.amountOwingCents / 100).toFixed(2) : "",
      row.finance ? (row.finance.amountPaidCents / 100).toFixed(2) : "",
      row.finance ? (row.finance.amountPayableCents / 100).toFixed(2) : "",
      row.finance?.artistFeeCents == null ? "" : (row.finance.artistFeeCents / 100).toFixed(2),
    ] : []),
    row.remark, row.submittedBy,
  ]);
  return [headers, ...values].map((row) => row.map(csvCell).join(",")).join("\n");
}
