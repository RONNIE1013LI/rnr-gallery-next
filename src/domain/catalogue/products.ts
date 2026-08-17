import type { Product, ProductCategory } from "./types";

export const PRODUCT_SHOP_IMAGES = {
  "photo-print-canvas": {
    src: "/media/products/photo-print-canvas-shop.webp",
    alt: "A large family photograph printed directly on a gallery-wrapped canvas",
  },
  "digital-oil-painting-canvas": {
    src: "/media/products/digital-oil-painting-canvas-shop.webp",
    alt: "A personalised painterly family artwork displayed on a gallery-wrapped canvas",
  },
  "custom-themed-canvas": {
    src: "/media/products/custom-themed-canvas-shop.webp",
    alt: "A multi-photo family collage composed and printed on a gallery-wrapped canvas",
  },
  "roll-up-banner": {
    src: "/media/products/roll-up-banner-shop.webp",
    alt: "A personalised 21st birthday roll-up banner standing on its complete display base",
  },
  "banner-bundle": {
    src: "/media/products/banner-bundle.png",
    alt: "A roll-up banner and matching wall banner prepared as a personalised event package",
  },
  "custom-themed-wall-banner": {
    src: "/media/products/wall-hanging-banner-shop.webp",
    alt: "A wide personalised first birthday wall banner hung by its corner eyelets",
  },
  "digital-oil-painting-banner": {
    src: "/media/products/digital-oil-painting-banner-shop.webp",
    alt: "A wide painterly welcome-home portrait banner hung by reinforced corner eyelets",
  },
  "grave-cover": {
    src: "/media/products/grave-cover-shop.webp",
    alt: "A personalised memorial grave cover secured flat at a graveside",
  },
} as const;

export const products = Object.freeze([
  {
    key: "photo-print-canvas",
    slug: "photo-print-canvas",
    category: "canvas",
    workflowKey: "photo_print_canvas",
    title: "Photo Print Canvas",
    summary: "Your complete photo printed as a clean, gallery-wrapped canvas.",
    image: PRODUCT_SHOP_IMAGES["photo-print-canvas"],
    startingPriceExGstCents: 6_500,
    active: true,
    featured: false,
  },
  {
    key: "digital-oil-painting-canvas",
    slug: "digital-oil-painting-canvas",
    category: "canvas",
    workflowKey: "digital_oil_painting_canvas",
    title: "Digital Oil Painting Canvas",
    summary: "A painterly portrait created from your photos and finished on canvas.",
    image: PRODUCT_SHOP_IMAGES["digital-oil-painting-canvas"],
    startingPriceExGstCents: 10_500,
    active: true,
    featured: true,
  },
  {
    key: "custom-themed-canvas",
    slug: "custom-themed-canvas",
    category: "canvas",
    workflowKey: "custom_themed_canvas",
    title: "Custom Themed Canvas",
    summary: "Photos, names and meaningful wording composed into one personal design.",
    image: PRODUCT_SHOP_IMAGES["custom-themed-canvas"],
    startingPriceExGstCents: 11_800,
    active: true,
    featured: false,
  },
  {
    key: "roll-up-banner",
    slug: "roll-up-banner",
    category: "banners",
    workflowKey: "roll_up_banner",
    title: "Roll-Up Banner",
    summary: "Our roll-up banner includes custom design, an 85 × 200 cm printed banner, stand, carry bag, pegs and box.",
    image: PRODUCT_SHOP_IMAGES["roll-up-banner"],
    startingPriceExGstCents: 23_000,
    active: true,
    featured: true,
  },
  {
    key: "custom-themed-wall-banner",
    slug: "custom-themed-wall-banner",
    category: "banners",
    workflowKey: "custom_themed_wall_banner",
    title: "Custom Themed Wall Banner",
    summary: "A large-format fabric banner designed for tributes, celebrations and events.",
    image: PRODUCT_SHOP_IMAGES["custom-themed-wall-banner"],
    startingPriceExGstCents: 16_500,
    active: true,
    featured: true,
  },
  {
    key: "digital-oil-painting-banner",
    slug: "digital-oil-painting-banner",
    category: "banners",
    workflowKey: "digital_oil_painting_banner",
    title: "Digital Oil Painting Banner",
    summary: "Painterly portrait artwork prepared for a durable large-format banner.",
    image: PRODUCT_SHOP_IMAGES["digital-oil-painting-banner"],
    startingPriceExGstCents: 16_000,
    active: true,
    featured: false,
  },
  {
    key: "grave-cover",
    slug: "grave-cover",
    category: "banners",
    workflowKey: "grave_cover",
    title: "Grave Cover",
    summary: "A custom 100 cm × 200 cm grave cover with reinforced eyelets and personalised artwork.",
    image: PRODUCT_SHOP_IMAGES["grave-cover"],
    startingPriceExGstCents: 18_500,
    active: true,
    featured: false,
  },
  {
    key: "banner-bundle",
    slug: "banner-bundle",
    category: "banners",
    workflowKey: "banner_bundle",
    title: "Banner Bundle",
    summary: "A complete 85 × 200 cm roll-up banner and matching wall banner package, customised separately for your event.",
    image: PRODUCT_SHOP_IMAGES["banner-bundle"],
    startingPriceExGstCents: 31_303,
    active: true,
    featured: false,
  },
] satisfies readonly Product[]);

export function getProductBySlug(slug: string): Product | undefined {
  return products.find((product) => product.active && product.slug === slug);
}

export function getProductsByCategory(
  category: ProductCategory,
): readonly Product[] {
  return products.filter(
    (product) => product.active && product.category === category,
  );
}
