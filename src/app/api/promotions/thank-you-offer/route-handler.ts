import { getPublicThankYouOfferEnabled } from "@/server/promotions/thank-you-offer-state";

type Dependencies = Readonly<{ enabled: () => Promise<boolean> }>;

export function createThankYouOfferRoute(dependencies: Dependencies = { enabled: getPublicThankYouOfferEnabled }) {
  return {
    async GET() {
      let enabled = false;
      try {
        enabled = await dependencies.enabled();
      } catch {
        // A failed read must never advertise an available promotion.
      }
      return Response.json({ enabled }, { headers: { "Cache-Control": "no-store" } });
    },
  };
}

export const GET = createThankYouOfferRoute().GET;
