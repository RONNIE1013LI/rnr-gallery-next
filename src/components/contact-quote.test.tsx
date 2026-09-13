import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactQuote } from "./contact-quote";
const analytics = vi.hoisted(() => ({ emitAnalyticsEvent: vi.fn() }));
vi.mock("@/domain/analytics/client", () => analytics);
class FakeRequest {
  static requests: FakeRequest[] = [];
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 202;
  responseText = JSON.stringify({ status: "accepted" });
  timeout = 0;
  body: FormData | null = null;
  open() {}
  setRequestHeader() {}
  send(body: FormData) { this.body = body; FakeRequest.requests.push(this); }
  respond(status = 202, body: unknown = { status: "accepted" }) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
}
function fill() {
  fireEvent.change(screen.getByLabelText("Full name (required)"), { target: { value: "Sample Customer" } });
  fireEvent.change(screen.getByLabelText("Email (required)"), { target: { value: "sample@example.test" } });
  fireEvent.change(screen.getByLabelText("Message / design idea (required)"), { target: { value: "Please help me choose a canvas." } });
}
describe("contact quote form", () => {
  beforeEach(() => { FakeRequest.requests = []; vi.stubGlobal("XMLHttpRequest", FakeRequest); analytics.emitAnalyticsEvent.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it("shows accessible required-field errors before any request", () => {
    render(<ContactQuote />);
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your full name");
    expect(screen.getByLabelText("Full name (required)")).toHaveFocus();
    expect(FakeRequest.requests).toHaveLength(0);
  });
  it("tracks only confirmed success and prevents duplicate clicks while uploading", async () => {
    render(<ContactQuote />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(FakeRequest.requests).toHaveLength(1);
    expect(analytics.emitAnalyticsEvent).not.toHaveBeenCalled();
    act(() => FakeRequest.requests[0].upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "50");
    analytics.emitAnalyticsEvent.mockImplementationOnce(() => { throw new Error("analytics unavailable"); });
    await act(async () => FakeRequest.requests[0].respond());
    expect(screen.getByRole("status")).toHaveTextContent("Your enquiry has been sent");
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({ event: "generate_lead", method: "website_quote_form" });
    expect(screen.queryByRole("button", { name: "Send enquiry" })).not.toBeInTheDocument();
  });
  it("keeps a failed request immutable and retries with the same request ID and photos", async () => {
    render(<ContactQuote />); fill();
    fireEvent.change(screen.getByLabelText("Optional photos"), { target: { files: [new File(["sample"], "sample.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    await act(async () => FakeRequest.requests[0].respond(503, { error: "Unavailable" }));
    expect(screen.getByLabelText("Full name (required)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry enquiry" }));
    expect(FakeRequest.requests).toHaveLength(2);
    expect(FakeRequest.requests[1].body?.get("details")).toBe(FakeRequest.requests[0].body?.get("details"));
    expect(FakeRequest.requests[1].body?.getAll("photos")).toHaveLength(1);
    await act(async () => FakeRequest.requests[1].respond());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your enquiry has been sent"));
  });
  it("allows removing selected photos and rejects oversized files locally", () => {
    render(<ContactQuote />);
    fireEvent.change(screen.getByLabelText("Optional photos"), { target: { files: [new File(["sample"], "sample.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(screen.queryByText("sample.png")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Optional photos"), { target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Each photo must be 1 MB/);
    expect(FakeRequest.requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear photos" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(FakeRequest.requests).toHaveLength(1);
    expect(FakeRequest.requests[0].body?.getAll("photos")).toHaveLength(0);
  });
});
