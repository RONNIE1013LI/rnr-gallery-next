import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailTemplateForm } from "./email-template-form";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EmailTemplateForm", () => {
  it("previews templates with fictional sample values and lists available variables", () => {
    render(<EmailTemplateForm entries={entries} canPublish />);

    expect(screen.getByText("Receipt for Sample Customer — RNR-SAMPLE-1001 — NZ$264.50"))
      .toBeInTheDocument();
    expect(screen.getByText("{{customer_name}}", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("{{order_number}}", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("{{amount}}", { exact: true })).toBeInTheDocument();
  });

  it("saves drafts through the existing content mutation endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "saved" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    render(<EmailTemplateForm entries={entries} canPublish />);

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
    render(<EmailTemplateForm entries={entries} canPublish />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Unknown email template variable: email"))
      .toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      action: "publish",
    }));
  });
});
