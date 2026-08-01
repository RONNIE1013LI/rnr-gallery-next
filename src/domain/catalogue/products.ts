import type { Product, ProductCategory } from "./types";

export const products = Object.freeze([
  {
    key: "photo-print-canvas",
    slug: "photo-print-canvas",
    category: "canvas",
    workflowKey: "photo_print_canvas",
    title: "Photo Print Canvas",
    summary: "Your complete photo printed as a clean, gallery-wrapped canvas.",
    image: {
      src: "/media/home/family-canvas.webp",
      alt: "Family portrait presented as a landscape canvas in a warm interior",
    },
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
    image: {
      src: "/media/home/digital-oil-pet.webp",
      alt: "Custom digital oil portrait of a dog displayed on canvas",
    },
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
    image: {
      src: "/media/home/family-canvas.webp",
      alt: "Personalised family artwork printed as a landscape canvas",
    },
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
    summary: "A portable personalised display with stand, carry bag and custom artwork.",
    image: {
      src: "/media/home/roll-up-banner.webp",
      alt: "Personalised memorial roll-up banner displayed indoors",
    },
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
    image: {
      src: "/media/home/wall-banner.webp",
      alt: "Wide personalised memorial banner mounted on an interior wall",
    },
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
    image: {
      src: "/media/home/wall-banner.webp",
      alt: "Large-format portrait artwork shown as a wall banner",
    },
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
    summary: "A personalised memorial cover with reinforced eyelets and custom artwork.",
    image: {
      src: "/media/home/roll-up-banner.webp",
      alt: "Personalised memorial artwork prepared for a fabric grave cover",
    },
    startingPriceExGstCents: 18_500,
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
