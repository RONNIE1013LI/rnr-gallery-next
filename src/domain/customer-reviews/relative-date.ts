export type RelativeReviewDate = Readonly<{
  dateTime: string;
  label: string;
  title: string;
}>;

const aucklandCalendarDate = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid review date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid review date");
  }
  return date;
}

export function formatRelativeReviewDate(
  value: string,
  now = new Date(),
): RelativeReviewDate {
  const date = parseCalendarDate(value);
  const { year, month, day } = Object.fromEntries(
    aucklandCalendarDate.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const today = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const dayDifference = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto" });

  let label: string;
  if (Math.abs(dayDifference) < 31) {
    label = formatter.format(dayDifference, "day");
  } else {
    const monthDifference = (date.getUTCFullYear() - today.getUTCFullYear()) * 12 +
      date.getUTCMonth() - today.getUTCMonth();
    if (Math.abs(monthDifference) < 12) {
      label = formatter.format(monthDifference, "month");
    } else {
      label = formatter.format(date.getUTCFullYear() - today.getUTCFullYear(), "year");
    }
  }

  return Object.freeze({
    dateTime: value,
    label,
    title: new Intl.DateTimeFormat("en-NZ", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  });
}
