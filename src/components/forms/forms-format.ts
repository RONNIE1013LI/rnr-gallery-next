import type { FormOrderRow } from "@/server/forms/forms-workbench-service";

export const formsMoney = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
});

const formsDateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

export function formsLabel(value: string) {
  if (value === "rnr") return "R&R";
  if (value === "pickup") return "Pick up";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formsStatusKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function formsSubmittedAt(value: string) {
  return formsDateTime.format(new Date(value));
}

export function milestoneValue(
  row: FormOrderRow,
  key: keyof FormOrderRow["milestones"],
) {
  return row.milestones[key] ? "YES" : "NO";
}
