import { describe, expect, it } from "vitest";
import { adminAuditLogs, manualOrderNotificationOutbox, orderNotificationOutbox, orders, productionJobs } from "@/server/db/schema";
import { createDrizzleProductionJobRepository } from "./drizzle-production-job-repository";
import type { UpdateProductionJob } from "./production-job-service";

type Tracking = Pick<typeof productionJobs.$inferSelect, "trackingCarrier" | "trackingNumber" | "trackingUrl">;
const empty: Tracking = { trackingCarrier: null, trackingNumber: null, trackingUrl: null };
const tracked: Tracking = { trackingCarrier: "NZ Post", trackingNumber: "TRACK-123", trackingUrl: "https://example.test/track/123" };

// Replace only database I/O; exercise the real repository's status and outbox decisions.
function fixture(source: "manual" | "web", tracking: Tracking, deliveredAt: Date | null = null) {
  const current = {
    id: "job-1", source, orderId: source === "web" ? "order-1" : null,
    customerEmail: "customer@example.test", updatedAt: new Date("2026-10-01T00:00:00Z"),
    deliveredAt, pinnedAt: null, ...(source === "web" ? empty : tracking),
  };
  const linkedOrder = { id: "order-1", status: "new", customerEmail: current.customerEmail, ...tracking };
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const select = (selection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      const query = {
        where: () => query,
        for: () => query,
        limit: async () => {
          if (table === adminAuditLogs) return [];
          const row = table === orders ? linkedOrder : current;
          return [selection
            ? Object.fromEntries(Object.keys(selection).map((key) => [key, row[key as keyof typeof row]]))
            : row];
        },
      };
      return query;
    },
  });
  const transaction = {
    select,
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return { where: () => ({ returning: async () => [{ id: current.id }] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  const database = { select, transaction: async (run: (tx: typeof transaction) => unknown) => run(transaction) };
  const repository = createDrizzleProductionJobRepository(database as unknown as Parameters<typeof createDrizzleProductionJobRepository>[0]);
  return {
    writes,
    update: (patch: Partial<UpdateProductionJob> = {}) => repository.update({
      jobId: current.id, idempotencyKey: "shipping-update", expectedUpdatedAt: current.updatedAt,
      actor: { userId: "admin-1", email: "admin@example.test" }, canUpdateFinance: false,
      updatedAt: new Date("2026-10-01T01:00:00Z"), deliveredAt: new Date("2026-10-01T01:00:00Z"),
      ...patch,
    }),
  };
}

describe.each(["manual", "web"] as const)("%s Shipped notification", (source) => {
  it.each([
    { name: "empty saved tracking", saved: empty, patch: {}, count: 0 },
    { name: "whitespace-only tracking", saved: { trackingCarrier: " ", trackingNumber: "\t", trackingUrl: " " }, patch: {}, count: 0 },
    { name: "tracking cleared in the same save", saved: tracked, patch: empty, count: 0 },
    { name: "tracking added in the same save", saved: empty, patch: tracked, count: 1 },
    { name: "saved tracking omitted from the patch", saved: tracked, patch: {}, count: 1 },
    { name: "carrier only", saved: { ...empty, trackingCarrier: "NZ Post" }, patch: {}, count: 1 },
    { name: "number only", saved: { ...empty, trackingNumber: "TRACK-123" }, patch: {}, count: 1 },
    { name: "URL only", saved: { ...empty, trackingUrl: "https://example.test/track" }, patch: {}, count: 1 },
  ])("handles $name without suppressing the status update", async ({ saved, patch, count }) => {
    const job = fixture(source, saved);
    await expect(job.update(patch)).resolves.toBe("updated");
    const outboxTable = source === "manual" ? manualOrderNotificationOutbox : orderNotificationOutbox;
    expect(job.writes.filter((write) => write.table === outboxTable)).toHaveLength(count);
    expect(job.writes.find((write) => write.table === productionJobs)?.values.deliveredAt)
      .toEqual(new Date("2026-10-01T01:00:00Z"));
    if (source === "web") {
      expect(job.writes.find((write) => write.table === orders && write.values.fulfilmentStatus)?.values.fulfilmentStatus)
        .toBe("completed");
    }
  });

  it("does not enqueue another email for an already shipped job", async () => {
    const job = fixture(source, tracked, new Date("2026-10-01T00:00:00Z"));
    await expect(job.update()).resolves.toBe("updated");
    expect(job.writes.filter((write) => write.table === manualOrderNotificationOutbox || write.table === orderNotificationOutbox)).toHaveLength(0);
  });

  it("does not enqueue an email when tracking is added without marking shipped", async () => {
    const job = fixture(source, empty);
    await expect(job.update({ ...tracked, deliveredAt: undefined })).resolves.toBe("updated");
    expect(job.writes.filter((write) => write.table === manualOrderNotificationOutbox || write.table === orderNotificationOutbox)).toHaveLength(0);
  });
});
