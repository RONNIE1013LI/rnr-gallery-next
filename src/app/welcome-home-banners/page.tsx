import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("welcome-home-banners");

export default async function Page() {
  return renderOccasionLanding("welcome-home-banners");
}
