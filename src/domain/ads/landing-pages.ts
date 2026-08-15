export type AdLandingPageContent = Readonly<{
  path: `/${string}`;
  productSlug: string;
  eyebrow: string;
  heading: string;
  description: string;
  sizeSummary: string;
  included: readonly string[];
  examples: readonly Readonly<{ src: string; alt: string }>[];
  faq: readonly Readonly<{ question: string; answer: string }>[];
}>;

export const adLandingPages = Object.freeze({
  rollUp: {
    path: "/custom-roll-up-banners-nz",
    productSlug: "roll-up-banner",
    eyebrow: "Custom roll-up banners NZ",
    heading: "Custom Roll-Up Banners for New Zealand Events",
    description: "A complete portable display with your photos, wording and custom design, ready for birthdays, celebrations and business events.",
    sizeSummary: "85 × 200 cm finished banner",
    included: ["Custom design", "Printed roll-up banner", "Display stand", "Carry bag", "Pegs", "Protective box"],
    examples: [
      { src: "/media/products/roll-up-banner-shop.webp", alt: "Personalised birthday roll-up banner with its display stand" },
      { src: "/media/home/homepage-product-roll-up-banner.webp", alt: "Custom roll-up banner displayed at an event" },
    ],
    faq: [
      { question: "What is included?", answer: "The package includes custom design, the printed banner, stand, carry bag, pegs and box." },
      { question: "Can I send photos after ordering?", answer: "Yes. Upload photos while customising or send them afterwards by Messenger, Email or WhatsApp." },
      { question: "Will I see a proof?", answer: "Yes. A proof is provided before printing and two revision rounds are included." },
    ],
  },
  wallBanner: {
    path: "/custom-wall-banners-nz",
    productSlug: "custom-themed-wall-banner",
    eyebrow: "Custom wall banners NZ",
    heading: "Custom Wall Banners for Celebrations and Events",
    description: "Turn photos, names and event wording into a large-format fabric wall banner with a custom composition.",
    sizeSummary: "160 × 80 cm, 200 × 100 cm or 300 × 150 cm",
    included: ["Custom themed design", "Large-format fabric print", "Reinforced corner eyelets", "Photo and wording placement"],
    examples: [
      { src: "/media/products/wall-hanging-banner-shop.webp", alt: "Wide personalised birthday wall banner with corner eyelets" },
      { src: "/media/home/homepage-product-wall-banner-birthday.webp", alt: "Custom birthday wall banner displayed for a celebration" },
    ],
    faq: [
      { question: "Which sizes are available?", answer: "Choose 160 × 80 cm, 200 × 100 cm or 300 × 150 cm while customising." },
      { question: "How are photos supplied?", answer: "Upload clear original files while ordering or choose to send them afterwards." },
      { question: "Can I check the wording before printing?", answer: "Yes. Review the proof and use the two included revision rounds before approval." },
    ],
  },
  photoCanvas: {
    path: "/custom-photo-canvas-nz",
    productSlug: "photo-print-canvas",
    eyebrow: "Custom photo canvas NZ",
    heading: "Custom Photo Canvas Prints in New Zealand",
    description: "Print one complete photo as a clean gallery-wrapped canvas in the size and orientation that suits your space.",
    sizeSummary: "A4, A3, A2, A1 and A0 sizes",
    included: ["Full-photo canvas print", "Gallery-wrapped finish", "Landscape or portrait orientation", "Proof before printing"],
    examples: [
      { src: "/media/products/photo-print-canvas-shop.webp", alt: "Family photograph printed on a gallery-wrapped canvas" },
      { src: "/media/home/family-canvas.webp", alt: "Finished custom family photo canvas" },
    ],
    faq: [
      { question: "Which photo should I use?", answer: "Use the clearest original file available. Uploading on the customising page is recommended for preserving original quality." },
      { question: "Can I choose portrait or landscape?", answer: "Yes. Choose the orientation and finished size while customising." },
      { question: "How long does production take?", answer: "Standard production time is 5 business days from the date the order is placed." },
    ],
  },
} satisfies Record<string, AdLandingPageContent>);
