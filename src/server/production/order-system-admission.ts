import { and, eq, inArray, or } from "drizzle-orm";
import { orders, productionJobs } from "@/server/db/schema";

export function orderSystemAdmissionCondition() {
  return or(
    eq(productionJobs.source, "manual"),
    and(
      eq(productionJobs.source, "web"),
      inArray(orders.paymentStatus, ["paid", "refunded"]),
    ),
  )!;
}
