import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredCustomerServiceAttachments } from "./cleanup-customer-service-attachments";

describe("cleanupExpiredCustomerServiceAttachments", () => {
  it("deletes expired attempt-owned objects before recording cleanup and logs counts only", async () => {
    const events: string[] = [];
    const output = vi.fn();
    const repository = {
      cleanupExpiredImageAttachments: vi.fn(async ({ remove }: { remove: (storageKey: string) => Promise<void> }) => {
        events.push("selected");
        await remove("customer-service-attachments/11111111-1111-4111-8111-111111111111.bin");
        events.push("marked-deleted");
        return { selected: 1, deleted: 1, failed: 0 };
      }),
    };

    await cleanupExpiredCustomerServiceAttachments({
      repository,
      store: { remove: async (storageKey) => { events.push(`removed:${storageKey}`); } },
      write: output,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(events).toEqual([
      "selected",
      "removed:customer-service-attachments/11111111-1111-4111-8111-111111111111.bin",
      "marked-deleted",
    ]);
    expect(repository.cleanupExpiredImageAttachments).toHaveBeenCalledWith(expect.objectContaining({
      limit: 100,
      now: new Date("2026-08-17T00:00:00.000Z"),
    }));
    expect(output).toHaveBeenCalledWith("customer_service_image_cleanup selected=1 deleted=1 failed=0\\n");
  });

  it("does not expose storage keys or error details in cleanup output", async () => {
    const output = vi.fn();
    await cleanupExpiredCustomerServiceAttachments({
      repository: {
        cleanupExpiredImageAttachments: async () => ({ selected: 2, deleted: 1, failed: 1 }),
      },
      store: { remove: async () => undefined },
      write: output,
    });

    expect(output).toHaveBeenCalledWith("customer_service_image_cleanup selected=2 deleted=1 failed=1\\n");
    expect(output.mock.calls.flat().join(" ")).not.toMatch(/customer-service-attachments|https?:|[0-9a-f]{64}/i);
  });
});
