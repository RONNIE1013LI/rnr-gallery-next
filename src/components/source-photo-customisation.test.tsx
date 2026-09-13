import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as analytics from "@/domain/analytics/client";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import {
  SourcePhotoCustomisation,
  type SourcePhotoCustomisationValue,
} from "./source-photo-customisation";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

const schema = getConfigurationSchema("banner-bundle")!;

function initialValue(): SourcePhotoCustomisationValue {
  return {
    photoSubmissionMethod: "upload",
    designText: "",
    notes: "",
    uploadedFiles: [],
    extraBackgroundRemovalUploadIds: [],
  };
}

function TwoGroups() {
  const [rollUp, setRollUp] = useState(initialValue);
  const [wallBanner, setWallBanner] = useState(initialValue);

  return (
    <form>
      <SourcePhotoCustomisation
        analyticsProductId="banner-bundle:roll-up"
        groupLabel="Roll-Up Banner customisation"
        inputName="roll-up"
        sourceStepNumber={2}
        artworkStepNumber={3}
        schema={schema}
        market="NZ"
        taxRegistered
        backgroundRemovalFeeInclTaxCents={2_000}
        value={rollUp}
        onChange={setRollUp}
      />
      <SourcePhotoCustomisation
        analyticsProductId="banner-bundle:wall-banner"
        groupLabel="Wall Banner customisation"
        inputName="wall-banner"
        sourceStepNumber={4}
        artworkStepNumber={5}
        schema={schema}
        market="NZ"
        taxRegistered
        backgroundRemovalFeeInclTaxCents={2_000}
        value={wallBanner}
        onChange={setWallBanner}
      />
    </form>
  );
}

describe("SourcePhotoCustomisation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(analytics.emitAnalyticsEvent).mockClear();
  });

  it("tracks only product ID and count after upload, plus an explicit send-later choice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reference: { id: "private-reference", originalName: "private-family-name.jpg" },
      }),
    }));
    render(<TwoGroups />);

    fireEvent.change(screen.getByLabelText("Roll-Up Banner customisation: Choose files"), {
      target: { files: [new File(["photo"], "private-family-name.jpg", { type: "image/jpeg" })] },
    });

    expect((await screen.findAllByText("Photo 1"))[0]).toBeVisible();
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "photo_upload_completed",
      product_id: "banner-bundle:roll-up",
      photo_count: 1,
    });
    expect(JSON.stringify(vi.mocked(analytics.emitAnalyticsEvent).mock.calls))
      .not.toContain("private-family-name.jpg");

    fireEvent.click(within(screen.getByRole("region", {
      name: "Roll-Up Banner customisation",
    })).getByText("Send Photos After Ordering"));
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "send_photos_later_selected",
      product_id: "banner-bundle:roll-up",
    });
  });

  it("labels two groups and all of their controlled inputs independently", () => {
    render(<TwoGroups />);

    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    const wallBanner = screen.getByRole("region", { name: "Wall Banner customisation" });

    expect(within(rollUp).getByRole("radiogroup", {
      name: "Roll-Up Banner customisation photo submission",
    })).toBeVisible();
    expect(within(wallBanner).getByRole("radiogroup", {
      name: "Wall Banner customisation photo submission",
    })).toBeVisible();
    expect(screen.getByLabelText("Roll-Up Banner customisation: Choose files"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Wall Banner customisation: Choose files"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Roll-Up Banner customisation: Text for your design"))
      .toBeVisible();
    expect(screen.getByLabelText("Wall Banner customisation: Text for your design"))
      .toBeVisible();
    expect(screen.getByLabelText("Roll-Up Banner customisation: Design notes")).toBeVisible();
    expect(screen.getByLabelText("Wall Banner customisation: Design notes")).toBeVisible();
  });

  it("links every send-later contact method to the existing public channels", () => {
    render(<TwoGroups />);

    for (const groupName of [
      "Roll-Up Banner customisation",
      "Wall Banner customisation",
    ]) {
      const group = within(screen.getByRole("region", { name: groupName }));
      expect(group.getByRole("link", { name: "Messenger" })).toHaveAttribute(
        "href",
        "https://m.me/RandRgallery",
      );
      expect(group.getByRole("link", { name: "Email" })).toHaveAttribute(
        "href",
        "mailto:customerservice@rnrgallery.com",
      );
      expect(group.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
        "href",
        "https://wa.me/642102348948",
      );
      expect(group.getByRole("link", { name: "Messenger" })).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
      expect(group.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
    }
  });

  it("keeps upload, main-photo, background-removal, removal, and send-later state independent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      const file = (init?.body as FormData).get("file") as File;
      return {
        ok: true,
        json: async () => ({
          reference: { id: `${file.name}-reference`, originalName: file.name },
        }),
      };
    }));
    render(<TwoGroups />);

    fireEvent.change(screen.getByLabelText("Roll-Up Banner customisation: Choose files"), {
      target: {
        files: [
          new File(["roll-1"], "roll-one.jpg", { type: "image/jpeg" }),
          new File(["roll-2"], "roll-two.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Wall Banner customisation: Choose files"), {
      target: {
        files: [
          new File(["wall-1"], "wall-one.jpg", { type: "image/jpeg" }),
          new File(["wall-2"], "wall-two.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    const wallBanner = screen.getByRole("region", { name: "Wall Banner customisation" });
    expect(await within(rollUp).findByText("Photo 2")).toBeVisible();
    expect(await within(wallBanner).findByText("Photo 2")).toBeVisible();

    expect(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Remove Photo 1",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Set Photo 2 as main",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Set Photo 2 as main",
    })).toBeVisible();

    fireEvent.click(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Toggle background removal for Photo 2",
    }));
    expect(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Toggle background removal for Photo 2",
    }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Toggle background removal for Photo 2",
    }))
      .toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Set Photo 2 as main",
    }));
    expect(within(rollUp).getAllByText("Main photo")).toHaveLength(2);
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    }).closest("article"))
      .toHaveTextContent("Main photo");

    fireEvent.click(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Remove Photo 1",
    }));
    expect(within(rollUp).queryByText("Photo 2")).not.toBeInTheDocument();
    expect(within(wallBanner).getByText("Photo 2")).toBeVisible();

    fireEvent.click(within(rollUp).getByText("Send Photos After Ordering"));
    expect(within(rollUp).queryByText("Photo 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    }))
      .toBeVisible();
    fireEvent.click(within(rollUp).getByText("Upload Photos Now"));
    expect(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Remove Photo 1",
    }))
      .toBeVisible();
  });

  it("keeps a failed upload error beside only its own control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "The image contents do not match the selected file type." }),
    }));
    render(<TwoGroups />);

    fireEvent.change(screen.getByLabelText("Roll-Up Banner customisation: Choose files"), {
      target: { files: [new File(["bad"], "bad.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByRole("alert", {
      name: "Roll-Up Banner customisation: Upload error",
    })).toHaveTextContent(
      "The image contents do not match the selected file type.",
    );
    expect(screen.queryByRole("alert", {
      name: "Wall Banner customisation: Upload error",
    })).not.toBeInTheDocument();
  });
});
