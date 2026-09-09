import { buildOccasionMetadata, renderOccasionLanding } from "@/server/seo/occasion-landing";

export const metadata = buildOccasionMetadata("21st-birthday-banners");

export default async function Page() {
  return renderOccasionLanding("21st-birthday-banners");
}
