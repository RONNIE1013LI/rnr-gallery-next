import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/server/auth/require-session";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { normalizeStaffAccessProfile } from "@/server/auth/staff-access-profile";
import { createFormsJobsExportRoute } from "./route-handler";

const row = {
  id: "job-1", source: "manual", version: "2026-08-05T00:00:00.000Z", submittedAt: "2026-08-05T00:00:00.000Z",
  reference: "07188", webOrderNumber: "6304", size: "A0", urgent: true,
  neededDate: "2026-08-12", deliveryMethod: "post", customerSource: "rnr",
  customerName: "=FORMULA()", customerEmail: "safe@example.test", customerPhone: "0210000000",
  assignedUserId: null, artistName: "Unassigned", status: "designing", paymentStatus: "paid",
  milestones: { fileSent: true, downloaded: false, customerNotified: false, printed: false, completed: false, delivered: false },
  bankRecon: "Arrive", finance: { amountOwingCents: 13000, amountPaidCents: 10000, amountPayableCents: 23000, artistFeeCents: 5000 },
  remark: "Ready", submittedBy: "Rosemary",
} as const;

describe("forms jobs CSV export", () => {
  it("exports the actor-visible columns, escapes formulas and records the export", async () => {
    const list = vi.fn().mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 100, pageCount: 1 });
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const route = createFormsJobsExportRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "operator-1", email: "operator@example.test" },
        formRole: "form_staff",
        formProfile: buildFormAccessProfile("finance"),
      }),
      list,
      recordExport,
    });
    const response = await route.GET(new Request("https://shop.example.test/api/forms/jobs/export?filter=urgent~equals~true"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(await response.text()).toContain("'=FORMULA()");
    expect(list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      canViewPaymentProof: true,
    }));
    expect(recordExport).toHaveBeenCalledWith(expect.objectContaining({ rowCount: 1, filterCount: 1 }));
  });

  it("requires export permission before reading jobs", async () => {
    const list = vi.fn();
    const route = createFormsJobsExportRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list,
      recordExport: vi.fn(),
    });
    const response = await route.GET(new Request("https://shop.example.test/api/forms/jobs/export"));
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps custom Staff exports assigned-only", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100, pageCount: 0 });
    const route = createFormsJobsExportRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "staff-1", email: "staff@example.test" },
        formRole: "staff",
        formProfile: normalizeStaffAccessProfile({
          adminPermissions: [],
          formPermissions: { export_jobs: true },
          assignedOnly: true,
        }),
      }),
      list,
      recordExport: vi.fn(),
    });

    const response = await route.GET(new Request("https://shop.example.test/api/forms/jobs/export"));

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: "staff-1",
      assignedOnly: true,
    }));
  });
});
