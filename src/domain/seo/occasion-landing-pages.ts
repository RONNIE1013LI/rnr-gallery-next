import { parseGalleryQuery, type GalleryQuery } from "@/domain/gallery/query";
import { deliveryCopy } from "@/domain/content/delivery-copy";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

export type OccasionLandingSlug = "birthday-banners" | "1st-birthday-banners" | "21st-birthday-banners" | "memorial-banners" | "graduation-banners" | "polynesian-banners";
export type OccasionLandingContent = Readonly<{
  path: `/${OccasionLandingSlug}`;
  label: string;
  title: string;
  heading: string;
  description: string;
  introduction: string;
  query: GalleryQuery;
  artworkHeading: string;
  artworkNote?: string;
  productSlugs: readonly string[];
  cta: string;
  guidanceHeading: string;
  guidance: readonly string[];
  faq: readonly Readonly<{ question: string; answer: string }>[];
  related: readonly OccasionLandingSlug[];
  parent?: "birthday-banners";
}>;

const bannerTypes = ["roll-up-banner", "wall-hanging-banners"];
const bannerProducts = ["roll-up-banner", "custom-themed-wall-banner"];
const proofAnswer = "Yes. You review the design proof and approve the artwork before it is printed.";
const timingAnswer = `${deliveryCopy.production} Allow time for delivery as well. If your event is close, ask the team to confirm availability before relying on an urgent order.`;

export const occasionLandingPages: Readonly<Record<OccasionLandingSlug, OccasionLandingContent>> = {
  "birthday-banners": {
    path: "/birthday-banners", label: "Birthday Banners", title: "Custom Birthday Banners NZ",
    heading: "Custom Birthday Banners Designed From Your Photos",
    description: "Explore real birthday banner designs and choose a personalised wall or roll-up banner with your photos, wording and a proof before printing.",
    introduction: "Make your photos, name and birthday message the centre of the celebration. Explore finished designs across different ages, then choose a banner format for your venue.",
    query: parseGalleryQuery({ occasion: "birthday", design_type: bannerTypes }),
    artworkHeading: "Birthday designs for different milestones",
    productSlugs: bannerProducts, cta: "Start Your Birthday Banner",
    guidanceHeading: "Plan the banner around your celebration",
    guidance: ["Choose a main photo that will read clearly from across the room, or supply a selection for a photo composition.", "Include the name, age, event wording and colour direction in your brief. A wide wall banner suits a backdrop; a roll-up banner comes with a stand for an upright display."],
    faq: [
      { question: "Can the banner include several birthday photos?", answer: "Yes. Supply the photos you would like included and explain which one should be the main image. The layout is reviewed in your design proof." },
      { question: "Which format suits a party entrance or a backdrop?", answer: "A roll-up banner is an upright display with its own stand. A wall banner is a wide format with corner eyelets; check the available hanging space at your venue." },
      { question: "Can I choose my own colours and wording?", answer: "Include your preferred colours, name, birthday message and any reference ideas when customising. Check these details carefully in the proof." },
      { question: "Will I see the birthday design before printing?", answer: proofAnswer },
      { question: "How early should I order for the party?", answer: timingAnswer },
    ], related: ["1st-birthday-banners", "21st-birthday-banners"],
  },
  "1st-birthday-banners": {
    path: "/1st-birthday-banners", label: "1st Birthday Banners", title: "1st Birthday Banners NZ | Custom Photo Designs",
    heading: "Custom 1st Birthday Banners",
    description: "Celebrate a first birthday with a custom photo banner. Browse genuine 1st Birthday designs and choose a wall or roll-up format with proof approval.",
    introduction: "Start with a favourite baby photo, your child's name and the colours for the party. These first-birthday examples show different ways to bring the photos and ONE wording together.",
    query: parseGalleryQuery({ occasion: "birthday", birthday_age: "1st Birthday", design_type: bannerTypes }),
    artworkHeading: "Real first-birthday designs", productSlugs: ["custom-themed-wall-banner", "roll-up-banner"], cta: "Start Your 1st Birthday Banner",
    guidanceHeading: "Choose the details that matter for their first birthday",
    guidance: ["One clear portrait can be the focus, with smaller photos alongside it if you want to show different moments from the first year.", "Send the child's name exactly as you want it printed, your preferred ONE or 1st Birthday wording, and a colour or theme reference. Consider where the banner will sit behind the cake or beside the entrance."],
    faq: [
      { question: "Should I choose one baby photo or several?", answer: "Either can work. Select the clearest photo for the main portrait and tell us if you would like smaller photos included in the composition." },
      { question: "Can the design say ONE instead of 1st Birthday?", answer: "Add the exact wording you want, including the child's name and any date. The proof lets you check spelling and placement before printing." },
      { question: "Can I provide colours or theme references?", answer: "Yes. Include your colour ideas and references in the brief so the team can review the design direction with you." },
      { question: "Is a wall banner or roll-up better for the cake area?", answer: "Measure the space first. A wall banner gives you a wide backdrop and needs a suitable hanging position. A roll-up banner is an upright option with a stand." },
      { question: "Can I check my child's name and photo placement first?", answer: proofAnswer },
    ], related: ["birthday-banners"], parent: "birthday-banners",
  },
  "21st-birthday-banners": {
    path: "/21st-birthday-banners", label: "21st Birthday Banners", title: "21st Birthday Banners NZ | Personalised Photo Banners",
    heading: "Personalised 21st Birthday Banners",
    description: "Browse real 21st Birthday photo banners. Create a personalised portrait or photo composition in a wall or roll-up format, with a proof before printing.",
    introduction: "Create a display for a milestone celebration, from a single portrait to a collection of photos. Add the name, date and words that belong to the occasion.",
    query: parseGalleryQuery({ occasion: "birthday", birthday_age: "21st Birthday", design_type: bannerTypes }),
    artworkHeading: "Real twenty-first birthday designs", productSlugs: bannerProducts, cta: "Start Your 21st Birthday Banner",
    guidanceHeading: "Build a milestone display with a clear focal point",
    guidance: ["Choose a main portrait for impact, then decide whether childhood or family photos should support it. Send separate original files where possible.", "Write out any quote, scripture or message exactly as you want it printed. Include the name, date and colour direction, and share your own cultural references if they are part of the celebration."],
    faq: [
      { question: "Can I combine a current portrait with childhood photos?", answer: "Yes. Supply the separate images and identify the main portrait. Explain the order or importance of the supporting photos in your brief." },
      { question: "Can a 21st banner include scripture or a quote?", answer: "Include the exact text and any reference you want shown. Check the wording, punctuation and layout in the proof before approving it." },
      { question: "Which format works beside a stage or at the entrance?", answer: "A roll-up banner is an upright display supplied with a stand. Choose a wall banner when you have space and a suitable hanging position for a wider composition." },
      { question: "Can I share family or cultural design references?", answer: "Yes. Share your references and explain the direction you want. The team can discuss how to incorporate your photos and wording into the composition." },
      { question: "Will the birthday person or family be able to review the design?", answer: proofAnswer },
    ], related: ["birthday-banners"], parent: "birthday-banners",
  },
  "memorial-banners": {
    path: "/memorial-banners", label: "Memorial Banners", title: "Memorial & Funeral Banners NZ",
    heading: "Custom Memorial & Funeral Banners",
    description: "Explore memorial and funeral banner examples. Choose a portrait display, wall banner or grave cover, with remembrance wording and a proof before printing.",
    introduction: "A practical place to choose a photo display for a funeral, remembrance gathering or celebration of life. Supply the portrait, dates and wording you would like the design to include.",
    query: parseGalleryQuery({ occasion: "memorial", design_type: [...bannerTypes, "grave-cover"] }),
    artworkHeading: "Memorial designs and remembrance formats", productSlugs: [...bannerProducts, "grave-cover"], cta: "Start Your Memorial Banner",
    guidanceHeading: "Prepare the portrait and wording for review",
    guidance: ["Choose one main portrait, or send additional family photos with instructions about their placement. Include names and dates in the exact form you want printed.", "You may supply scripture, a remembrance message and your own background or cultural references. A roll-up or wall banner is a display format; a grave cover is a separate remembrance option. Confirm any close event deadline with the team."],
    faq: [
      { question: "Can the design use one portrait with family photos?", answer: "Yes. Identify the main portrait and supply the additional photos separately. Include any placement preferences in your instructions." },
      { question: "Can I include dates, scripture and remembrance wording?", answer: "Send the exact names, dates and text to include. Please review every detail in the proof before giving approval to print." },
      { question: "How do I choose between a banner and a grave cover?", answer: "Roll-up and wall banners are display options for a gathering. A grave cover is a separate format with its own product options. Review the product details for the setting you have in mind." },
      { question: "What if the service is soon?", answer: "Contact the team with the service date before relying on an urgent order. Availability and delivery need to be confirmed for your circumstances." },
      { question: "Will we receive a proof before printing?", answer: proofAnswer },
    ], related: [],
  },
  "graduation-banners": {
    path: "/graduation-banners", label: "Graduation Banners", title: "Custom Graduation Banners NZ",
    heading: "Personalised Graduation Banners",
    description: "Create a graduation photo banner with a portrait, year and personal message. Explore a real graduation example and choose a wall or roll-up display.",
    introduction: "Put the graduate's portrait and achievement at the centre of a family celebration. Add the graduation year, qualification wording and a personal message to your brief.",
    query: parseGalleryQuery({ occasion: "graduation", design_type: bannerTypes }),
    artworkHeading: "A finished graduation design", artworkNote: "Our published graduation selection is small. Use this example as a starting point, then provide your own photos and details.",
    productSlugs: bannerProducts, cta: "Start Your Graduation Banner",
    guidanceHeading: "Make the achievement easy to read",
    guidance: ["Start with a clear graduate portrait and write the name, graduation year and qualification exactly as you want them shown. A short message leaves more space for the photo.", "Share your preferred colours and choose the format for your venue: an upright roll-up display or a wide hanging banner. This is a personalised family or event design service; no school or university affiliation is implied."],
    faq: [
      { question: "Which graduation details should I supply?", answer: "Include the graduate's name, portrait, graduation year and the exact qualification wording you want printed. Add a personal message if you would like one." },
      { question: "Can I request colours that suit the celebration?", answer: "Yes. Supply your preferred colour direction and references with the brief. Any school or university references are customer instructions, not a claim of endorsement." },
      { question: "Can the banner include a family message or quote?", answer: "Send the exact wording and explain whether it should be a prominent heading or a smaller supporting message." },
      { question: "Which banner is easier to position for family photos?", answer: "A roll-up banner has its own stand for an upright display. A wall banner offers a wider format and needs suitable hanging space; check your venue before choosing." },
      { question: "Can we check the qualification spelling before printing?", answer: proofAnswer },
    ], related: [],
  },
  "polynesian-banners": {
    path: "/polynesian-banners", label: "Pacific & Cultural Banners", title: "Custom Pacific & Polynesian-Inspired Banners",
    heading: "Pacific & Polynesian-Inspired Banners",
    description: "Explore mixed cultural and island-inspired banner examples. Share your own photos, wording and cultural references for a personalised design and print proof.",
    introduction: "Bring your photos, event wording and your own cultural references to a custom banner brief. Choose a wall or roll-up format and discuss the design direction with the team.",
    query: parseGalleryQuery({ theme: "cultural-island", design_type: bannerTypes }),
    artworkHeading: "Mixed cultural and island-inspired examples",
    artworkNote: "These examples belong to the gallery's broad Cultural / Island collection. Individual cultural identities are not recorded, so the designs are not attributed to a specific tradition or labelled as a verified Polynesian collection.",
    productSlugs: ["custom-themed-wall-banner", "roll-up-banner"], cta: "Start Your Custom Banner",
    guidanceHeading: "Let your references guide the brief",
    guidance: ["Tell us the family, event or cultural context you want represented and provide your own visual references. Do not rely on a gallery image to identify a particular culture or the meaning of a motif.", "Include the exact names, language, message and colour preferences you want used. Review the composition and wording in the proof; the examples here do not make claims about traditional symbolism or authenticity."],
    faq: [
      { question: "Are all these examples identified as Polynesian designs?", answer: "No. These examples are grouped broadly as Cultural / Island, rather than identified by a particular Pacific tradition. Share your own references to explain the direction you want." },
      { question: "Can I provide my own family or cultural references?", answer: "Yes. Share the references you want considered and explain the context. The team can review your intended direction with your photos and wording." },
      { question: "Can I include wording in my own language?", answer: "Supply the exact text, spelling and any special characters. Check the wording carefully in the proof before approving the artwork." },
      { question: "Do you assign meanings to the patterns in these examples?", answer: "No cultural or symbolic meaning is claimed for the gallery examples. If a particular reference matters to your brief, explain it to the team rather than relying on an assumed meaning." },
      { question: "Can I choose a wall banner or a roll-up display?", answer: "Both formats are available through the existing product options. Choose a wide hanging banner or an upright roll-up banner with a stand to suit your space." },
    ], related: ["birthday-banners", "memorial-banners"],
  },
};

export function selectOccasionArtwork(content: OccasionLandingContent, items: readonly PublicGalleryItem[]): readonly PublicGalleryItem[] {
  const q = content.query;
  const unique = new Map(items.filter((item) =>
    q.productTypes.includes(item.productTypeSlug)
    && (!q.occasions.length || q.occasions.includes(item.occasionSlug))
    && (!q.birthdayAges.length || (item.subOccasion !== null && q.birthdayAges.includes(item.subOccasion)))
    && (!q.themes.length || q.themes.some((theme) => item.themeSlugs.includes(theme))),
  ).map((item) => [item.id, item]));
  const groups = new Map<string, PublicGalleryItem[]>();
  for (const item of unique.values()) {
    const key = `${item.subOccasion ?? item.occasionSlug}:${item.productTypeSlug}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const selected: PublicGalleryItem[] = [];
  while (selected.length < 18 && [...groups.values()].some((group) => group.length)) {
    for (const group of groups.values()) {
      const item = group.shift();
      if (item) selected.push(item);
      if (selected.length === 18) break;
    }
  }
  return selected;
}
