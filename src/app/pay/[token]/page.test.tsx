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
      robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    });
  });

  it("publishes the homepage social preview for crawlers", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ token: "A token/with spaces" }) })).toMatchObject({
      title: "Secure payment",
      description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
      openGraph: {
        title: "Secure payment",
        description: "Personalised canvas, banners and print artwork made with care in New Zealand.",
        url: "https://rnrgallery.com/pay/A%20token%2Fwith%20spaces",
        images: [{ url: "https://rnrgallery.com/media/social/rr-gallery-social-share-2026.webp" }],
      },
      twitter: {
        card: "summary_large_image",
        images: ["https://rnrgallery.com/media/social/rr-gallery-social-share-2026.webp"],
      },
    });
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
