import { describe, expect, it, vi } from "vitest";
import {
  ProductionFieldConflictError,
  ProductionFieldValidationError,
  createProductionFieldService,
  type ProductionFieldRepository,
} from "./production-field-service";

const actor = { userId: "admin-1", email: "ADMIN@EXAMPLE.COM" };
const now = new Date("2026-08-05T04:00:00.000Z");

function repository(overrides: Partial<ProductionFieldRepository> = {}): ProductionFieldRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000020", fieldKey: "venue" }),
    update: vi.fn().mockResolvedValue("updated"),
    ...overrides,
  };
}

describe("production field service", () => {
  it("creates a normalized select field without allowing arbitrary schema", async () => {
    const repo = repository();
    const service = createProductionFieldService(repo, { now: () => now });
    await service.create(actor, {
      idempotencyKey: "field-create-0001",
      fieldKey: " event_venue ",
      label: " Event venue ",
      fieldType: "select",
      section: "order",
      options: [" Hall ", "Church", "Hall"],
      required: false,
      enabled: true,
      showOnCreate: true,
      showOnDetail: true,
      showOnList: false,
      legacyOnly: false,
      sortOrder: 20,
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      fieldKey: "event_venue",
      label: "Event venue",
      options: ["Hall", "Church"],
      actor: { userId: "admin-1", email: "admin@example.com" },
      createdAt: now,
    }));
  });

  it.each([
    { fieldKey: "Bad key" },
    { fieldType: "script" },
    { fieldType: "select", options: [] },
    { fieldType: "text", options: ["Unexpected"] },
    { legacyOnly: true, showOnCreate: true },
  ])("rejects invalid configuration %#", async (override) => {
    const service = createProductionFieldService(repository());
    await expect(service.create(actor, {
      idempotencyKey: "field-create-invalid",
      fieldKey: "event_venue",
      label: "Event venue",
      fieldType: "text",
      section: "order",
      options: [],
      required: false,
      enabled: true,
      showOnCreate: true,
      showOnDetail: true,
      showOnList: false,
      legacyOnly: false,
      sortOrder: 20,
      ...override,
    })).rejects.toBeInstanceOf(ProductionFieldValidationError);
  });

  it("updates display settings without accepting a replacement field key", async () => {
    const repo = repository();
    const service = createProductionFieldService(repo, { now: () => now });
    await service.update(actor, {
      fieldId: "00000000-0000-4000-8000-000000000020",
      idempotencyKey: "field-update-0001",
      expectedUpdatedAt: "2026-08-05T03:00:00.000Z",
      label: "Venue",
      fieldType: "text",
      section: "order",
      options: [],
      required: false,
      enabled: false,
      showOnCreate: false,
      showOnDetail: true,
      showOnList: false,
      legacyOnly: false,
      sortOrder: 30,
    });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({
      fieldId: "00000000-0000-4000-8000-000000000020",
      expectedUpdatedAt: new Date("2026-08-05T03:00:00.000Z"),
      enabled: false,
      updatedAt: now,
    }));

    await expect(service.update(actor, {
      fieldId: "00000000-0000-4000-8000-000000000020",
      fieldKey: "replacement_key",
      idempotencyKey: "field-update-0002",
      expectedUpdatedAt: "2026-08-05T03:00:00.000Z",
      label: "Venue",
      fieldType: "text",
      section: "order",
      options: [],
      required: false,
      enabled: false,
      showOnCreate: false,
      showOnDetail: true,
      showOnList: false,
      legacyOnly: false,
      sortOrder: 30,
    })).rejects.toBeInstanceOf(ProductionFieldValidationError);
  });

  it("surfaces optimistic update conflicts", async () => {
    const service = createProductionFieldService(repository({
      update: vi.fn().mockResolvedValue("conflict"),
    }));
    await expect(service.update(actor, {
      fieldId: "00000000-0000-4000-8000-000000000020",
      idempotencyKey: "field-update-conflict",
      expectedUpdatedAt: "2026-08-05T03:00:00.000Z",
      label: "Venue",
      fieldType: "text",
      section: "order",
      options: [],
      required: false,
      enabled: true,
      showOnCreate: true,
      showOnDetail: true,
      showOnList: false,
      legacyOnly: false,
      sortOrder: 20,
    })).rejects.toBeInstanceOf(ProductionFieldConflictError);
  });
});
