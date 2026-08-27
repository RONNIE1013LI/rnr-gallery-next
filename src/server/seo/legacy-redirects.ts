const legacyPathRedirectGroups = [
  { destination: "/design-gallery", sources: ["/gallery"] },
  { destination: "/about", sources: ["/about-rr"] },
  { destination: "/privacy", sources: ["/cookies-policy"] },
  { destination: "/canvas", sources: ["/product-category/canvas"] },
  { destination: "/banners", sources: ["/product-category/banner"] },
  {
    destination: "/products/roll-up-banner",
    sources: [
      "/product-category/banner/roll-up-banner",
      "/product/roll-up-banner-with-free-professional-custom-design",
      "/product/roll-up-banner-with-free-professional-custom-design-for-loss-of-loved-one",
      "/product/roll-up-banner-with-free-professional-custom-design-for-wedding-anniversary",
      "/product/roll-up-banner-with-free-professional-custom-design-for-business",
      "/product/roll-up-banner-with-free-professional-custom-design-for-21st-birthday",
      "/product/21st-birthday",
      "/product/roll-up-banner-with-free-professional-custom-design-for-5th-birthday",
      "/product/roll-up-banner-with-free-professional-custom-design-for-1st-birthday",
    ],
  },
  {
    destination: "/products/digital-oil-painting-canvas",
    sources: [
      "/product/digital-oil-painting-with-canvas",
      "/product/five-faces-customized-digital-oil-painting-with-canvas",
      "/product/four-faces-customized-digital-oil-painting-with-canvas",
      "/product/three-faces-customized-digital-oil-painting-with-canvas",
      "/product/two-faces-customized-digital-oil-painting-with-canvas",
      "/product/six-faces-or-more-customized-digital-oil-painting-with-canvas",
      "/product/turn-a-low-quality-image-into-a-refined-artwork-ready-for-display-with-canvas",
      "/product/poor-photo-to-a-masterpiece",
      "/product-category/canvas/customized-digital-oil-painting-on-canvas",
    ],
  },
  { destination: "/products/banner-bundle", sources: ["/product/banner-bundle"] },
  {
    destination: "/products/custom-themed-canvas",
    sources: [
      "/product/custom-heart-shaped-photo-collage-on-canvas",
      "/product/custom-number-photo-collage-with-canvas",
      "/product/custom-daddy-photos-collage-with-canvas",
      "/product/multi-photo-artwork-blends-on-canvas-copy",
      "/product-category/canvas/custom-collage-photos-on-canvas",
    ],
  },
  {
    destination: "/products/photo-print-canvas",
    sources: [
      "/product/portrait-photo-printing-with-canvas",
      "/product/landscape-photo-printing",
      "/product/wedding-photo-printing",
      "/product-category/canvas/normal-canvas",
    ],
  },
  {
    destination: "/products/digital-oil-painting-banner",
    sources: [
      "/product/single-face-customized-digital-oil-painting-on-banner",
      "/product/single-face-digital-painting-on-banner-copy",
      "/product/two-face-digital-painting-on-banner",
      "/product/four-face-digital-painting-on-banner",
      "/product/five-face-digital-painting-on-banner",
      "/product/six-faces-digital-painting-on-banner",
    ],
  },
  {
    destination: "/products/custom-themed-wall-banner",
    sources: [
      "/product/custom-themed-banner",
      "/product-category/banner/landscape-banner",
    ],
  },
] as const;

const legacyPathRedirects = new Map<string, string>(
  legacyPathRedirectGroups.flatMap(({ destination, sources }) =>
    sources.map((source) => [source, destination] as const),
  ),
);

export function getLegacyRedirectDestination(pathname: string): string | undefined {
  const normalized = pathname.length > 1
    ? pathname.replace(/\/$/, "")
    : pathname;
  return legacyPathRedirects.get(normalized);
}
