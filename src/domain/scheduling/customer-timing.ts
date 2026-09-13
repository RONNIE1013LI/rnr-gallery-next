import type { DeliveryPreference } from "@/domain/configuration/types";
import type { Market } from "@/domain/markets/types";
import { addWorkingDays, STANDARD_PRODUCTION_WORKING_DAYS } from "./urgent-service";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function estimatedArrival(productionDate: string, market: Market, delivery: DeliveryPreference) {
  if (market === "NZ" && delivery === "pickup") return { start: productionDate, end: productionDate };
  if (market === "NZ") return { start: addWorkingDays(productionDate, 2), end: addWorkingDays(productionDate, 3) };
  // The AU policy is in calendar days. Reserve its remote-area allowance until
  // the address and actual shipping service are selected at checkout. This range
  // is informational; it must never force rush fees or reject an AU order.
  return { start: addDays(productionDate, 7), end: addDays(productionDate, 14) };
}

export function getCustomerTiming(orderDate: string, needByDate: string, market: Market, delivery: DeliveryPreference, productionDate = addWorkingDays(orderDate, STANDARD_PRODUCTION_WORKING_DAYS)) {
  const arrival = estimatedArrival(productionDate, market, delivery);
  let error: string | null = null;
  if (needByDate) {
    try {
      addWorkingDays(needByDate, 1);
      if (needByDate < arrival.end) error = "The estimated arrival is after your selected date. You can still place your order if this timing is acceptable to you, or contact us to discuss options.";
    } catch {
      error = "Check your need-by date for a useful estimate. You can still continue with your order.";
    }
  }
  return { productionDate, estimatedArrivalStart: arrival.start, estimatedArrivalEnd: arrival.end, error };
}
