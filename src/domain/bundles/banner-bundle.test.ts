import { describe, expect, it } from "vitest";
import type { BannerBundleComponentCustomization } from "./banner-bundle";
import {
  flattenBannerBundleUploadReferences,
  getBannerBundleCounts,
  validateBannerBundleComponents,
} from "./banner-bundle";

function uploadIds(count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, index) =>
    `00000000-0000-4000-8000-${String(offset + index + 1).padStart(12, "0")}`,
  );
}

function component(
  componentKey: "roll-up" | "wall-banner",
  references: readonly string[],
  overrides: Partial<BannerBundleComponentCustomization> = {},
): BannerBundleComponentCustomization {
  return {
    componentKey,
    photoSubmissionMethod: references.length > 0 ? "upload" : "later",
    designText: `${componentKey} wording`,
    notes: `${componentKey} instructions`,
    uploadReferences: references,
    ...overrides,
  };
}

describe("Banner Bundle component customisations", () => {
  it("accepts and freezes exactly one component of each required key", () => {
    const rollUpId = uploadIds(1)[0];
    const result = validateBannerBundleComponents([
      component("roll-up", [rollUpId]),
      component("wall-banner", []),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        componentKey: "roll-up",
        mainPhotoUploadId: rollUpId,
      }),
      expect.objectContaining({
        componentKey: "wall-banner",
        photoSubmissionMethod: "later",
        uploadReferences: [],
      }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(result.every((entry) => Object.isFrozen(entry.uploadReferences))).toBe(true);
  });

  it.each([
    ["a missing component", [component("roll-up", [])]],
    ["a duplicate component key", [component("roll-up", []), component("roll-up", [])]],
  ])("rejects %s", (_label, value) => {
    expect(() => validateBannerBundleComponents(value)).toThrow();
  });

  it("requires at least one reference when uploading now", () => {
    expect(() => validateBannerBundleComponents([
      component("roll-up", [], { photoSubmissionMethod: "upload" }),
      component("wall-banner", []),
    ])).toThrow();
  });

  it("requires zero references when sending photos later", () => {
    expect(() => validateBannerBundleComponents([
      component("roll-up", uploadIds(1), { photoSubmissionMethod: "later" }),
      component("wall-banner", []),
    ])).toThrow();
  });

  it("rejects an upload ID used by both component groups", () => {
    const shared = uploadIds(1)[0];
    expect(() => validateBannerBundleComponents([
      component("roll-up", [shared]),
      component("wall-banner", [shared]),
    ])).toThrow();
  });

  it("accepts 50 references per group and rejects 51", () => {
    expect(() => validateBannerBundleComponents([
      component("roll-up", uploadIds(50)),
      component("wall-banner", uploadIds(50, 50)),
    ])).not.toThrow();
    expect(() => validateBannerBundleComponents([
      component("roll-up", uploadIds(51)),
      component("wall-banner", []),
    ])).toThrow();
  });

  it.each([
    [5, 5, 0, 0, 2, 1],
    [6, 5, 1, 0, 2, 1],
    [5, 6, 0, 1, 2, 1],
    [10, 10, 5, 5, 2, 1],
  ])(
    "counts %i Roll-Up and %i Wall Banner photos independently",
    (
      rollUpPhotos,
      wallBannerPhotos,
      rollUpExtraPhotos,
      wallBannerExtraPhotos,
      rollUpBackgroundRemovals,
      wallBannerBackgroundRemovals,
    ) => {
      const result = getBannerBundleCounts([
        component("roll-up", uploadIds(rollUpPhotos), {
          extraBackgroundRemovalUploadIds: uploadIds(rollUpPhotos).slice(1, 3),
        }),
        component("wall-banner", uploadIds(wallBannerPhotos, 50), {
          extraBackgroundRemovalUploadIds: uploadIds(wallBannerPhotos, 50).slice(1, 2),
        }),
      ]);

      expect(result).toEqual({
        rollUpExtraPhotos,
        wallBannerExtraPhotos,
        rollUpBackgroundRemovals,
        wallBannerBackgroundRemovals,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("flattens both upload groups in component order into a frozen array", () => {
    const result = flattenBannerBundleUploadReferences([
      component("roll-up", uploadIds(2)),
      component("wall-banner", uploadIds(2, 50)),
    ]);

    expect(result).toEqual([...uploadIds(2), ...uploadIds(2, 50)]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
