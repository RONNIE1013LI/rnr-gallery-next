import { describe, expect, it, vi } from "vitest";
import {
  ProductionSavedViewValidationError,
  createFormsSavedViewService,
  createProductionSavedViewService,
  normalizeFormsSavedViewQuery,
  normalizeSavedViewQuery,
  type ProductionSavedViewRepository,
} from "./production-saved-view-service";

const actor = { userId: "user-1", email: "staff@example.com" };
function repository(overrides: Partial<ProductionSavedViewRepository> = {}): ProductionSavedViewRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ result: "created", view: { id: "view-1", name: "Urgent print", queryString: "status=printing&urgent=yes" } }),
    remove: vi.fn().mockResolvedValue("deleted"),
    ...overrides,
  };
}

describe("production saved views", () => {
  it("normalizes only non-customer production filters", () => {
    expect(normalizeSavedViewQuery("urgent=yes&status=printing&direction=asc")).toBe("status=printing&urgent=yes&direction=asc");
    expect(() => normalizeSavedViewQuery("q=customer@example.com&urgent=yes")).toThrow(ProductionSavedViewValidationError);
    expect(() => normalizeSavedViewQuery("page=2")).toThrow(ProductionSavedViewValidationError);
  });

  it("creates and deletes views only for the current user", async () => {
    const repo = repository();
    const service = createProductionSavedViewService(repo);
    await service.create(actor, { name: " Urgent print ", queryString: "urgent=yes&status=printing" });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", name: "Urgent print", queryString: "status=printing&urgent=yes" }));
    await service.remove(actor, "e23a9f59-bf54-4bb6-a7d0-9239c14cf819");
    expect(repo.remove).toHaveBeenCalledWith("user-1", "staff@example.com", "e23a9f59-bf54-4bb6-a7d0-9239c14cf819");
  });
});

describe("forms saved views", () => {
  it("normalizes bounded operational form filters without storing search text", () => {
    expect(normalizeFormsSavedViewQuery("match=or&filter=urgent~equals~true&filter=status~equals~designing&direction=asc"))
      .toBe("match=or&direction=asc&filter=urgent%7Eequals%7Etrue&filter=status%7Eequals%7Edesigning");
    expect(() => normalizeFormsSavedViewQuery("q=customer%40example.test&filter=urgent~equals~true"))
      .toThrow(ProductionSavedViewValidationError);
  });

  it("reuses actor-scoped saved-view persistence", async () => {
    const repo = repository();
    const service = createFormsSavedViewService(repo);
    await service.create(
      { userId: "operator-1", email: "operator@example.test" },
      { name: "Urgent", queryString: "filter=urgent~equals~true" },
    );
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: "operator-1",
      name: "Urgent",
      queryString: "filter=urgent%7Eequals%7Etrue",
    }));
  });
});
