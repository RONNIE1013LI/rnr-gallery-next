const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const MATARIKI_DATES = new Set([
  "2022-06-24", "2023-07-14", "2024-06-28", "2025-06-20", "2026-07-10",
  "2027-06-25", "2028-07-14", "2029-07-06", "2030-06-21", "2031-07-11",
  "2032-07-02", "2033-06-24", "2034-07-07", "2035-06-29", "2036-07-18",
  "2037-07-10", "2038-06-25", "2039-07-15", "2040-07-06", "2041-07-19",
  "2042-07-11", "2043-07-03", "2044-06-24", "2045-07-07", "2046-06-29",
  "2047-07-19", "2048-07-03", "2049-06-25", "2050-07-15", "2051-06-30",
  "2052-06-21",
]);
const PUBLIC_HOLIDAYS_BY_YEAR = new Map<number, ReadonlySet<string>>();
export const URGENT_SERVICE_FEES_INCL_GST_CENTS = Object.freeze([0, 8_000, 7_000, 6_000, 5_000] as const);
export const DEFAULT_URGENT_SERVICE_FEES_INCL_GST_CENTS = Object.freeze(
  URGENT_SERVICE_FEES_INCL_GST_CENTS.slice(1),
);

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

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

function addHoliday(holidays: Set<string>, date: Date): void {
  holidays.add(formatIsoDate(date));
}

function addMondayisedHoliday(holidays: Set<string>, date: Date): void {
  addHoliday(holidays, date);
  if (date.getUTCDay() === 6) addHoliday(holidays, addCalendarDays(date, 2));
  if (date.getUTCDay() === 0) addHoliday(holidays, addCalendarDays(date, 1));
}

function addMondayisedHolidayPair(holidays: Set<string>, first: Date): void {
  const second = addCalendarDays(first, 1);
  addHoliday(holidays, first);
  addHoliday(holidays, second);

  switch (first.getUTCDay()) {
    case 5: // Friday / Saturday: second holiday is observed on Monday.
      addHoliday(holidays, addCalendarDays(second, 2));
      break;
    case 6: // Saturday / Sunday: observed on Monday / Tuesday.
      addHoliday(holidays, addCalendarDays(first, 2));
      addHoliday(holidays, addCalendarDays(second, 2));
      break;
    case 0: // Sunday / Monday: second is observed Monday, first on Tuesday.
      addHoliday(holidays, addCalendarDays(first, 2));
      break;
  }
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): Date {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (occurrence - 1) * 7);
}

function mondayNearest(year: number, month: number, day: number): Date {
  const target = utcDate(year, month, day);
  const previousMondayOffset = (target.getUTCDay() + 6) % 7;
  const previousMonday = addCalendarDays(target, -previousMondayOffset);
  const nextMonday = addCalendarDays(previousMonday, 7);
  return target.getTime() - previousMonday.getTime() <= nextMonday.getTime() - target.getTime()
    ? previousMonday
    : nextMonday;
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month - 1, day);
}

function publicHolidaysForYear(year: number): ReadonlySet<string> {
  const cached = PUBLIC_HOLIDAYS_BY_YEAR.get(year);
  if (cached) return cached;

  const holidays = new Set<string>();
  addMondayisedHolidayPair(holidays, utcDate(year, 0, 1));
  addMondayisedHoliday(holidays, utcDate(year, 1, 6));
  addHoliday(holidays, mondayNearest(year, 0, 29)); // Auckland Anniversary Day

  const easter = easterSunday(year);
  addHoliday(holidays, addCalendarDays(easter, -2)); // Good Friday
  addHoliday(holidays, addCalendarDays(easter, 1)); // Easter Monday
  addMondayisedHoliday(holidays, utcDate(year, 3, 25));
  addHoliday(holidays, nthWeekdayOfMonth(year, 5, 1, 1)); // King's Birthday
  addHoliday(holidays, nthWeekdayOfMonth(year, 9, 1, 4)); // Labour Day
  addMondayisedHolidayPair(holidays, utcDate(year, 11, 25));

  const matariki = [...MATARIKI_DATES].find((date) => date.startsWith(`${year}-`));
  if (matariki) holidays.add(matariki);

  PUBLIC_HOLIDAYS_BY_YEAR.set(year, holidays);
  return holidays;
}

function isWorkingDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0
    && day !== 6
    && !publicHolidaysForYear(date.getUTCFullYear()).has(formatIsoDate(date));
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

export function getUrgentService(
  orderDate: string,
  neededDate: string,
  feesInclGstCents: readonly number[] = DEFAULT_URGENT_SERVICE_FEES_INCL_GST_CENTS,
) {
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

  const feeInclGstCents = feesInclGstCents[workingDays - 1] ?? 0;
  if (!Number.isSafeInteger(feeInclGstCents) || feeInclGstCents < 0) {
    throw new InvalidNeededDateError("Urgent service price is invalid.");
  }
  return Object.freeze({
    workingDays,
    feeInclGstCents,
    requiresConfirmation: feeInclGstCents > 0,
  });
}
