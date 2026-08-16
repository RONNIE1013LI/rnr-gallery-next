import { describe, expect, it } from "vitest";
import {
  defaultCustomerEmailSignatureValues,
  renderCustomerEmailSignature,
} from "./customer-email-signature";

describe("customer email signature", () => {
  it("renders the approved default signature and official logo", () => {
    const signature = renderCustomerEmailSignature({}, "https://rrgallery.co.nz/path");

    expect(signature.text).toContain("Kind regards,\nCustomer Service Team");
    expect(signature.text).toContain("Customer Service | R&R Gallery Ltd. NZ");
    expect(signature.text).toContain("customerservice@rnrgallery.com");
    expect(signature.text).toContain("rrgallery.co.nz");
    expect(signature.text).toContain("11 Para Close, Fairview Heights, Auckland 0632.");
    expect(signature.html).toContain(
      'src="https://rrgallery.co.nz/media/brand/rr-gallery-email-logo.png"',
    );
    expect(signature.html).toContain('alt="R&amp;R Gallery"');
    expect(signature.html).toContain('href="https://rrgallery.co.nz/"');
    expect(signature.html).toContain('href="mailto:customerservice%40rnrgallery.com"');
  });

  it("places a square logo beside a four-line contact block at matching height", () => {
    const signature = renderCustomerEmailSignature({}, "https://rrgallery.co.nz");
    const container = document.createElement("div");
    container.innerHTML = signature.html;

    const layout = container.querySelector('table[role="presentation"]');
    const cells = layout?.querySelectorAll("td");
    const logo = cells?.[0]?.querySelector("img");

    expect(layout).not.toBeNull();
    expect(cells).toHaveLength(2);
    expect(cells?.[0]).toHaveAttribute("width", "84");
    expect(cells?.[0]).toHaveStyle({ width: "84px", minWidth: "84px" });
    expect(logo).toHaveAttribute("width", "72");
    expect(logo).toHaveAttribute("height", "72");
    expect(logo).toHaveStyle({ width: "72px", maxWidth: "72px", height: "72px" });
    expect(cells?.[1]).toHaveTextContent("Customer Service | R&R Gallery Ltd. NZ");
    expect(cells?.[1]).toHaveTextContent("customerservice@rnrgallery.com");
    expect(cells?.[1]).toHaveTextContent("rrgallery.co.nz");
    expect(cells?.[1]).toHaveTextContent("11 Para Close, Fairview Heights, Auckland 0632.");
  });

  it("escapes published display text without changing trusted destinations", () => {
    const signature = renderCustomerEmailSignature({
      "email.signature.team_name": "Support & Care",
      "email.signature.website_label": "Our <Gallery>",
    }, "https://shop.example.test/account");

    expect(signature.html).toContain("Support &amp; Care");
    expect(signature.html).toContain("Our &lt;Gallery&gt;");
    expect(signature.html).toContain('href="https://shop.example.test/"');
    expect(signature.html).not.toContain("<Gallery>");
  });

  it("falls back field by field when published values are missing", () => {
    const signature = renderCustomerEmailSignature({
      ...defaultCustomerEmailSignatureValues,
      "email.signature.signoff": "Warm regards,",
      "email.signature.address": undefined,
    }, "https://rrgallery.co.nz");

    expect(signature.text).toContain("Warm regards,");
    expect(signature.text).toContain("11 Para Close, Fairview Heights, Auckland 0632.");
  });
});
