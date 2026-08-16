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
      'src="https://rrgallery.co.nz/media/brand/rr-gallery-logo-2026.webp"',
    );
    expect(signature.html).toContain('alt="R&amp;R Gallery"');
    expect(signature.html).toContain('href="https://rrgallery.co.nz/"');
    expect(signature.html).toContain('href="mailto:customerservice%40rnrgallery.com"');
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
