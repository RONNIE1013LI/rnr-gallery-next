import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AboutPage, { metadata as aboutMetadata } from "./about/page";
import ContactPage, { metadata as contactMetadata } from "./contact/page";
import HelpPage, { metadata as helpMetadata } from "./help/page";
import ShippingDeliveryPage, { metadata as shippingMetadata } from "./shipping-delivery/page";

describe("public help pages", () => {
  it("publishes confirmed business and contact information", () => {
    render(<><AboutPage /><ContactPage /></>);

    expect(screen.getAllByText(/R&R Gallery Ltd/i)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "customerservice@rnrgallery.com" }))
      .toHaveAttribute("href", "mailto:customerservice@rnrgallery.com");
    expect(screen.getByRole("link", { name: "+64 21 023 48948" }))
      .toHaveAttribute("href", "tel:+642102348948");
    expect(screen.getByRole("link", { name: "WhatsApp" }))
      .toHaveAttribute("href", "https://wa.me/642102348948");
    expect(screen.getByRole("link", { name: "Messenger" }))
      .toHaveAttribute("href", "https://m.me/RandRgallery");
  });

  it("publishes only confirmed ordering, proof and delivery guidance", () => {
    render(<><HelpPage /><ShippingDeliveryPage /></>);

    expect(screen.getAllByText(/proof before printing/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/two revision/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 business days/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/New Zealand.*2–3 business days/i)).toBeVisible();
    expect(screen.getByText(/Australia.*approximately 5 business days/i)).toBeVisible();
    expect(screen.queryByText(/refund|guaranteed delivery|damage compensation/i)).not.toBeInTheDocument();
  });

  it.each([
    [aboutMetadata, "https://rrgallery.co.nz/about"],
    [contactMetadata, "https://rrgallery.co.nz/contact"],
    [helpMetadata, "https://rrgallery.co.nz/help"],
    [shippingMetadata, "https://rrgallery.co.nz/shipping-delivery"],
  ])("has unique indexable metadata for %s", (metadata, canonical) => {
    expect(metadata.alternates).toMatchObject({ canonical });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });
});
