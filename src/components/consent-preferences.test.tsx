import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsentPreferences,
  CookiePreferencesTrigger,
  useAdvertisingConsent,
} from "./consent-preferences";
import { SiteFooter } from "./site-footer";

function State() {
  const consent = useAdvertisingConsent();
  return <output>{consent ? `${consent.analytics}:${consent.advertising}` : "none"}</output>;
}

function StateWithTrigger() {
  return <><State /><CookiePreferencesTrigger /></>;
}

function savedResponse(analytics: boolean, advertising: boolean) {
  return new Response(JSON.stringify({
    consent: {
      version: 1,
      analytics,
      advertising,
      decidedAt: "2026-08-28T01:02:03.000Z",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("ConsentPreferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps both transports denied until Accept all is saved", async () => {
    const fetch = vi.fn().mockResolvedValue(savedResponse(true, true));
    vi.stubGlobal("fetch", fetch);
    render(<ConsentPreferences initialConsent={null}><StateWithTrigger /></ConsentPreferences>);

    expect(screen.getByText("none")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));

    await waitFor(() => expect(screen.getByText("true:true")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/consent", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics: true, advertising: true }),
    }));
    expect(screen.getByRole("button", { name: "Cookie preferences" })).toBeInTheDocument();
  });

  it("places My account below Cart and Cookie preferences first under Customer", () => {
    render(<ConsentPreferences initialConsent={{
      version: 1,
      analytics: false,
      advertising: false,
      decidedAt: "2026-08-28T01:02:03.000Z",
    }}><SiteFooter /></ConsentPreferences>);

    const footer = screen.getByRole("contentinfo");
    const cart = within(footer).getByRole("link", { name: "Cart" });
    const account = within(footer).getByRole("link", { name: "My account" });
    const preferences = within(footer).getByRole("button", { name: "Cookie preferences" });
    const shop = footer.querySelector(".site-footer__shop");
    const customer = footer.querySelector(".site-footer__customer");

    expect(account.parentElement?.previousElementSibling).toBe(cart.parentElement);
    expect(shop).toContainElement(account);
    expect(shop).not.toContainElement(preferences);
    expect(customer?.querySelector("li:first-child")).toBe(preferences.parentElement);
    expect(customer).toContainElement(preferences);
    expect(customer).not.toContainElement(account);
  });

  it("saves independent managed preferences and permits later revocation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(savedResponse(true, false))
      .mockResolvedValueOnce(savedResponse(false, false));
    vi.stubGlobal("fetch", fetch);
    render(<ConsentPreferences initialConsent={null}><StateWithTrigger /></ConsentPreferences>);

    fireEvent.click(screen.getByRole("button", { name: "Manage preferences" }));
    const analytics = screen.getByRole("checkbox", { name: "Analytics measurement" });
    fireEvent.click(analytics);
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(screen.getByText("true:false")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cookie preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Essential only" }));

    await waitFor(() => expect(screen.getByText("false:false")).toBeInTheDocument());
    expect(fetch).toHaveBeenLastCalledWith("/api/consent", expect.objectContaining({
      body: JSON.stringify({ analytics: false, advertising: false }),
    }));
  });

  it("keeps the prior choice and reports an accessible error when saving fails", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    render(<ConsentPreferences initialConsent={{
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-28T01:02:03.000Z",
    }}><StateWithTrigger /></ConsentPreferences>);

    fireEvent.click(screen.getByRole("button", { name: "Cookie preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be saved"));
    expect(screen.getByText("true:false")).toBeInTheDocument();
  });
});
