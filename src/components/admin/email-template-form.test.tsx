import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmailTemplateForm,
  type AdminEmailTemplateEntry,
} from "./email-template-form";

const entries = Object.freeze([
  {
    key: "email.payment_confirmed.subject",
    surface: "email" as const,
    group: "Customer payment confirmed",
    label: "Subject",
    description: "Subject sent after payment is confirmed.",
    maxLength: 200,
    multiline: false,
    defaultValue: "Payment confirmed — {{order_number}}",
    allowedVariables: ["customer_name", "order_number", "amount"],
    draftValue: "Receipt for {{customer_name}} — {{order_number}} — {{amount}}",
    publishedValue: "Payment confirmed — {{order_number}}",
    updatedAt: null,
    updatedByEmail: null,
  },
] as const);

const signatureEntries = Object.freeze([
  ["email.signature.signoff", "Sign-off", "Kind regards,"],
  ["email.signature.team_name", "Team name", "Customer Service Team"],
  ["email.signature.company_line", "Company line", "Customer Service | R&R Gallery Ltd. NZ"],
  ["email.signature.email", "Customer-service email", "customerservice@rnrgallery.com"],
  ["email.signature.website_label", "Website label", "rnrgallery.com"],
  ["email.signature.address", "Street address", "11 Para Close, Fairview Heights, Auckland 0632."],
].map(([key, label, value]) => ({
  key,
  surface: "email" as const,
  group: "Customer email signature",
  label,
  description: `${label} used in customer emails.`,
  maxLength: 320,
  multiline: false,
  defaultValue: value,
  allowedVariables: [],
  draftValue: value,
  publishedValue: value,
  updatedAt: null,
  updatedByEmail: null,
}))) as readonly AdminEmailTemplateEntry[];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EmailTemplateForm", () => {
  it("previews templates with fictional sample values and lists available variables", () => {
    render(<EmailTemplateForm entries={entries} canPublish siteUrl="https://rnrgallery.com" />);

    expect(screen.getByText("Receipt for Sample Customer — RNR-SAMPLE-1001 — NZ$264.50"))
      .toBeInTheDocument();
    expect(screen.getByText("{{customer_name}}", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("{{order_number}}", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("{{amount}}", { exact: true })).toBeInTheDocument();
  });

  it("renders one complete live customer-signature preview", () => {
    render(
      <EmailTemplateForm
        entries={signatureEntries}
        canPublish
        siteUrl="https://rnrgallery.com"
      />,
    );

    const previewRegion = screen.getByRole("region", { name: "Live signature preview" });
    expect(previewRegion).toHaveTextContent("Kind regards,");
    expect(previewRegion).toHaveTextContent("Customer Service Team");
    expect(previewRegion).toHaveTextContent("Customer Service | R&R Gallery Ltd. NZ");
    expect(previewRegion).toHaveTextContent("customerservice@rnrgallery.com");
    expect(previewRegion).toHaveTextContent("rnrgallery.com");
    expect(previewRegion).toHaveTextContent("11 Para Close, Fairview Heights, Auckland 0632.");
    expect(previewRegion.querySelector("img")).toHaveAttribute(
      "src",
      "https://rnrgallery.com/media/brand/rr-gallery-email-logo.png",
    );
    expect(screen.queryByText("Sample preview")).not.toBeInTheDocument();
  });

  it("updates the combined preview before save and keeps display text escaped", () => {
    render(
      <EmailTemplateForm
        entries={signatureEntries}
        canPublish
        siteUrl="https://rnrgallery.com"
      />,
    );

    fireEvent.change(screen.getByDisplayValue("Customer Service Team"), {
      target: { value: "R&R <script>alert(1)</script> Care" },
    });

    const previewRegion = screen.getByRole("region", { name: "Live signature preview" });
    expect(previewRegion).toHaveTextContent("R&R <script>alert(1)</script> Care");
    expect(previewRegion.querySelector("script")).toBeNull();
  });

  it("saves drafts through the existing content mutation endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "saved" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    render(<EmailTemplateForm entries={entries} canPublish siteUrl="https://rnrgallery.com" />);

    fireEvent.change(screen.getByDisplayValue(entries[0].draftValue), {
      target: { value: "Receipt — {{order_number}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe("/api/admin/content/email.payment_confirmed.subject");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      action: "save",
      value: "Receipt — {{order_number}}",
      idempotencyKey: expect.any(String),
    }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
  });

  it("publishes only after confirmation and displays API validation errors", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Unknown email template variable: email",
    }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("fetch", fetch);
    render(<EmailTemplateForm entries={entries} canPublish siteUrl="https://rnrgallery.com" />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Unknown email template variable: email"))
      .toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      action: "publish",
    }));
  });

  it("edits signature fields through the same safe content endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "saved" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    render(<EmailTemplateForm entries={[{
      key: "email.signature.team_name",
      surface: "email",
      group: "Customer email signature",
      label: "Team name",
      description: "Customer-facing team name.",
      maxLength: 120,
      multiline: false,
      defaultValue: "Customer Service Team",
      allowedVariables: [],
      draftValue: "Customer Service Team",
      publishedValue: "Customer Service Team",
      updatedAt: null,
      updatedByEmail: null,
    }]} canPublish siteUrl="https://rnrgallery.com" />);

    expect(screen.getByText("No variables are available for this field.")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Customer Service Team"), {
      target: { value: "R&R Customer Care" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe("/api/admin/content/email.signature.team_name");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      action: "save",
      value: "R&R Customer Care",
    }));
  });
});
