import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("graduation-banners");

export default async function Page() {
  return renderOccasionLanding("graduation-banners");
}
