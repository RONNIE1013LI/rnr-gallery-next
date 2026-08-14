import { describe, expect, it, vi } from "vitest";

import { ProductionJobNotFoundError } from "@/server/production/production-job-service";
import { assertFormsJobScope } from "./forms-job-scope";

const assignedAccess = {
  user: { id: "artist-1", email: "artist@example.test" },
  formRole: "form_staff" as const,
  formProfile: {
    preset: "artist" as const,
    assignedOnly: true,
    permissions: {} as never,
  },
};

describe("assertFormsJobScope", () => {
  it("allows unrestricted operators without an extra lookup", async () => {
    const findAssignment = vi.fn();
    await assertFormsJobScope({ ...assignedAccess, formProfile: { ...assignedAccess.formProfile, assignedOnly: false } }, "job-1", findAssignment);
    expect(findAssignment).not.toHaveBeenCalled();
  });

  it("allows only the artist assigned to the job", async () => {
    await expect(assertFormsJobScope(
      assignedAccess,
      "job-1",
      vi.fn().mockResolvedValue("artist-1"),
    )).resolves.toBeUndefined();
    await expect(assertFormsJobScope(
      assignedAccess,
      "job-2",
      vi.fn().mockResolvedValue("artist-2"),
    )).rejects.toBeInstanceOf(ProductionJobNotFoundError);
  });
});
