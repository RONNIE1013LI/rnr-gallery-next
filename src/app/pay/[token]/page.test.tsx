import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

const { notFound, publicByToken, methods } = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  publicByToken: vi.fn(),
  methods: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/payment-requests/public-payment-request-runtime", () => ({
  getPublicPaymentRequestRuntime: () => ({
    requests: { publicByToken },
    payments: { availableMethodsForPaymentRequest: methods },
  }),
}));

import PaymentRequestPage, { dynamic, generateMetadata } from "./page";

describe("Payment Request page", () => {
  it("is dynamic and noindex", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(await generateMetadata({ params: Promise.resolve({ token: "token" }) })).toMatchObject({
      robots: { index: false, follow: true, noarchive: true, nosnippet: true },
    });
  });

  it("publishes the homepage social preview for crawlers", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ token: "A token/with spaces" }) })).toMatchObject({
      title: "R&R Gallery | Secure Payment",
      description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
      openGraph: {
        title: "R&R Gallery | Secure Payment",
        description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
        url: "https://rnrgallery.com/pay/A%20token%2Fwith%20spaces",
        type: "website",
        siteName: "R&R Gallery",
        images: [{
          url: "https://rnrgallery.com/media/social/rr-gallery-social-share-2026.jpg",
          width: 1200,
          height: 630,
          type: "image/jpeg",
          alt: "R&R Gallery custom canvas and digital oil painting display",
        }],
      },
      twitter: {
        card: "summary_large_image",
        title: "R&R Gallery | Secure Payment",
        description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
        images: ["https://rnrgallery.com/media/social/rr-gallery-social-share-2026.jpg"],
      },
    });
  });

  it("publishes only generic metadata without reading payment or payer data", async () => {
    publicByToken.mockClear();
    methods.mockClear();
    const token = randomBytes(32).toString("base64url");
    const metadata = await generateMetadata({ params: Promise.resolve({ token }) });
    const { url, ...social } = metadata.openGraph!;
    expect(url).toBe(`https://rnrgallery.com/pay/${token}`);
    expect({ ...metadata, openGraph: social }).toEqual({
      title: "R&R Gallery | Secure Payment",
      description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
      robots: { index: false, follow: true, noarchive: true, nosnippet: true },
      openGraph: {
        type: "website",
        siteName: "R&R Gallery",
        title: "R&R Gallery | Secure Payment",
        description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
        images: [{
          url: "https://rnrgallery.com/media/social/rr-gallery-social-share-2026.jpg",
          width: 1200, height: 630, type: "image/jpeg",
          alt: "R&R Gallery custom canvas and digital oil painting display",
        }],
      },
      twitter: {
        card: "summary_large_image",
        title: "R&R Gallery | Secure Payment",
        description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
        images: ["https://rnrgallery.com/media/social/rr-gallery-social-share-2026.jpg"],
      },
    });
    expect(publicByToken).not.toHaveBeenCalled();
    expect(methods).not.toHaveBeenCalled();
  });

  it("serves a baseline 1200 by 630 JPEG social asset", async () => {
    const image = await sharp("public/media/social/rr-gallery-social-share-2026.jpg").metadata();
    expect(image).toMatchObject({ format: "jpeg", width: 1200, height: 630, isProgressive: false });
  });

  it("loads the server-owned request and available methods", async () => {
    const token = "A234567890123456789012345678901234567890123";
    publicByToken.mockResolvedValue({
      requestNumber: "PAY-2026-ABC123", kind: "standalone", description: "Balance",
      amountCents: 20_000, currency: "NZD", status: "pending", methods: ["card"],
    });
    methods.mockResolvedValue([{ method: "card", label: "Card", isTest: false }]);
    const output = await PaymentRequestPage({ params: Promise.resolve({ token }) });
    expect(publicByToken).toHaveBeenCalledWith(token);
    expect(methods).toHaveBeenCalledWith(token, expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(output).toBeTruthy();
  });
});
