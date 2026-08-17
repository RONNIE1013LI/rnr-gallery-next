import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import {
  SourcePhotoCustomisation,
  type SourcePhotoCustomisationValue,
} from "./source-photo-customisation";

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
  afterEach(() => vi.unstubAllGlobals());

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

    fireEvent.click(within(rollUp).getByRole("button", { name: /^Remove background/ }));
    expect(within(rollUp).getByRole("button", { name: /Background removal/ }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(wallBanner).getByRole("button", { name: /^Remove background/ }))
      .toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(rollUp).getByRole("button", { name: "Set as main" }));
    expect(within(rollUp).getAllByText("Main photo")).toHaveLength(2);
    expect(within(wallBanner).getByRole("button", { name: "Remove Photo 1" }).closest("article"))
      .toHaveTextContent("Main photo");

    fireEvent.click(within(rollUp).getByRole("button", { name: "Remove Photo 1" }));
    expect(within(rollUp).queryByText("Photo 2")).not.toBeInTheDocument();
    expect(within(wallBanner).getByText("Photo 2")).toBeVisible();

    fireEvent.click(within(rollUp).getByText("Send Photos After Ordering"));
    expect(within(rollUp).queryByText("Photo 1")).not.toBeInTheDocument();
    expect(within(wallBanner).getByRole("button", { name: "Remove Photo 1" }))
      .toBeVisible();
    fireEvent.click(within(rollUp).getByText("Upload Photos Now"));
    expect(within(rollUp).getByRole("button", { name: "Remove Photo 1" }))
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

    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    const wallBanner = screen.getByRole("region", { name: "Wall Banner customisation" });
    expect(await within(rollUp).findByRole("alert")).toHaveTextContent(
      "The image contents do not match the selected file type.",
    );
    expect(within(wallBanner).queryByRole("alert")).not.toBeInTheDocument();
  });
});
