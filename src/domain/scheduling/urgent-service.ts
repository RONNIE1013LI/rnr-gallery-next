const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidNeededDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNeededDateError";
  }
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new InvalidNeededDateError("Date must use YYYY-MM-DD format.");

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (formatIsoDate(date) !== value) {
    throw new InvalidNeededDateError("Date is not a valid calendar date.");
  }
  return date;
}

function isWorkingDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function nextDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

export function addWorkingDays(orderDate: string, workingDays: number): string {
  if (!Number.isInteger(workingDays) || workingDays < 1) {
    throw new InvalidNeededDateError("Working days must be a positive integer.");
  }

  let date = parseIsoDate(orderDate);
  let remaining = workingDays;
  while (remaining > 0) {
    date = nextDay(date);
    if (isWorkingDay(date)) remaining -= 1;
  }
  return formatIsoDate(date);
}

export function getUrgentService(orderDate: string, neededDate: string) {
  const start = parseIsoDate(orderDate);
  const end = parseIsoDate(neededDate);
  if (end <= start) {
    throw new InvalidNeededDateError("Needed date must be after the order date.");
  }

  let date = start;
  let workingDays = 0;
  while (date < end) {
    date = nextDay(date);
    if (isWorkingDay(date)) workingDays += 1;
  }
  if (workingDays < 1) {
    throw new InvalidNeededDateError("Needed date must include a working day.");
  }

  const fees = [0, 8_000, 7_000, 6_000, 5_000];
  const feeInclGstCents = fees[workingDays] ?? 0;
  return Object.freeze({
    workingDays,
    feeInclGstCents,
    requiresConfirmation: feeInclGstCents > 0,
  });
}
