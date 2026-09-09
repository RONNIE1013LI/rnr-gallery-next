import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("1st-birthday-banners");

export default async function Page() {
  return renderOccasionLanding("1st-birthday-banners");
}
