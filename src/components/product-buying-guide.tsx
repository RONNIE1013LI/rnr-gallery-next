import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import type { Market } from "@/domain/markets/types";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import styles from "./storefront.module.css";
import guide from "./catalogue-seo.module.css";

const buyingGuides: Readonly<Record<string, Readonly<{
  heading: string;
  explanation: string;
  preparation: string;
  choice: string;
  galleryLabel: string;
  questions: readonly Readonly<{ question: string; answer: string }>[];
}>>> = {
  "photo-print-canvas": {
    heading: "Print your photo on gallery-wrapped canvas",
    explanation: "Choose Photo Canvas Prints to keep one favourite photograph as the artwork. It suits family portraits, wedding photos, pet photos and landscapes you already like as they are.",
    preparation: "Use the original photo file if you can. A screenshot or a file saved from social media may have less detail. If the photo is soft, dark or heavily cropped, ask us to check it before you choose a large print.",
    choice: "Compare the listed sizes and choose portrait or landscape to suit the photo. Measure the wall first and check the composition in your proof, especially if faces or important details sit near the edges.",
    galleryLabel: "Browse photo canvas examples",
    questions: [
      { question: "How do I choose a canvas size for my photo?", answer: "Start with the orientation of your photo and the space on your wall. If you are deciding between two sizes, send us the original file so we can advise whether it has enough detail for the larger print." },
      { question: "Can I order a photo canvas print online and send the photo later?", answer: "Yes. Choose your canvas size and orientation online. You can upload your photo when ordering or send it afterwards. Review the proof before printing." },
      { question: "Which canvas should I choose for several photos?", answer: "Choose Custom Themed Canvas for a collage or a design with names and wording. Choose Digital Oil Painting Canvas if you want a painterly portrait built from your photos." },
    ],
  },
  "custom-themed-canvas": {
    heading: "Create a personalised photo collage on canvas",
    explanation: "Use Custom Themed Canvas when you want several photos, names or meaningful wording arranged in one design. A family collage can preserve separate moments, or use one main portrait with smaller photos around it.",
    preparation: "Send separate original files and tell us which photos are most important. For a birthday, anniversary or memorial keepsake, include the exact names, dates and message and describe your preferred colours.",
    choice: "Pick a size that leaves room for the main photos and wording. The preview gives you a chance to check the photo order, spelling and readability before the canvas is printed.",
    galleryLabel: "Browse themed photo canvas designs",
    questions: [
      { question: "Can I make a canvas collage from several photos?", answer: "Yes. Send the photographs separately and tell us which one should be the focus. Our team arranges the photographs and any wording in the design proof for you to review." },
      { question: "What if I want people from different photos in one portrait?", answer: "If you want a single painterly portrait of people together, compare Digital Oil Painting Canvas. For a collage that shows the original pictures as separate moments, choose Custom Themed Canvas." },
    ],
  },
  "digital-oil-painting-canvas": {
    heading: "Turn a photo into a digital painting on canvas",
    explanation: "Your photos are used to create a painterly portrait, then the digital artwork is printed on canvas. This is a digital oil painting effect, not an oil painting applied by hand. For a photograph printed without this portrait treatment, choose Photo Print Canvas instead.",
    preparation: "Upload the clearest original photo files you have. Identify the main portrait and tell us which people, pets, background and wording you want included. If you want people brought together from separate photographs, supply each original and explain the composition you have in mind.",
    choice: "Check the available canvas sizes above and measure your display space. The selected size and artwork options determine the price. You review the design proof before printing, including the faces, composition and any spelling.",
    galleryLabel: "Browse digital portrait designs",
    questions: [
      { question: "Can you turn a family photo into a painting on canvas?", answer: "Yes. The team uses your photo as a reference, creates a digital painterly portrait and prints the approved artwork on canvas. The artwork can include people or pets from separate photos, subject to a review of the files." },
      { question: "Can I use an older photo for a memorial portrait?", answer: "Send the clearest original file or scan you have. Tell us which person to focus on and include any other references that show their features. We can assess the files before you commit to a large print." },
    ],
  },
  "custom-themed-wall-banner": {
    heading: "Plan your personalised photo birthday banner",
    explanation: "A fabric wall banner creates a wide display for a birthday cake area, party backdrop or event wall. Your photos, name, age and wording become one custom design. It needs a suitable place to hang; a roll-up banner is the standing alternative.",
    preparation: "Send original photos separately and identify the main portrait. Include the exact name, age, message and colour direction, plus any reference ideas. For several photos, explain which images should be most prominent.",
    choice: "Measure the wall and check the available sizes above before choosing. Allow space for hanging at the reinforced corner eyelets. Review the photo layout and all wording in your proof before approving printing.",
    galleryLabel: "Browse wall banner designs",
    questions: [
      { question: "What size photo banner works behind a birthday cake table?", answer: "Measure the space behind the table and confirm where you can hang the banner. Pick one of the listed wall banner sizes and let us know if the table will cover any of the artwork." },
      { question: "Can I put a name, age and several pictures on one birthday banner?", answer: "Yes. Decide which photo should stand out and send the other files separately with the exact name, age and message. Check the layout in the proof before approval." },
    ],
  },
  "roll-up-banner": {
    heading: "Choose a personalised roll-up banner for your event",
    explanation: "This upright display includes an 85 × 200 cm printed banner, stand, carry bag, pegs and box. It suits an entrance or event display when you want a standing banner, including birthday and memorial designs.",
    preparation: "Choose a clear main portrait and send your original photos, exact names, dates and message. Tell us which wording should be read from a distance and share any colours or design references you want considered.",
    choice: "Check the height and available floor space at your venue. If you need a wide backdrop instead, compare the wall banner format. Review the layout and spelling in the design proof; confirm any close event deadline with the team before ordering.",
    galleryLabel: "Browse roll-up banner designs",
    questions: [
      { question: "Is a pull-up banner the same as a roll-up banner?", answer: "Yes. Here both names refer to the same freestanding banner format. This is a complete personalised 85 × 200 cm pull-up banner with a stand, carry bag, pegs and box." },
      { question: "Can I order a standing birthday or memorial banner with my own photos?", answer: "Yes. Send the main portrait, any supporting photos and the wording you want. A short heading and a large photo usually read best when the banner is placed at an entrance." },
      { question: "How early should I order a pull-up banner for an event?", answer: "Leave time to review the proof, for production and for delivery. Share your event date and delivery location with us before ordering if the date is close." },
    ],
  },
  "grave-cover": {
    heading: "Prepare a personalised memorial grave cover",
    explanation: "A grave cover is a separate graveside tribute format, rather than a standing funeral banner. This custom 100 × 200 cm cover includes personalised artwork and reinforced eyelets.",
    preparation: "Supply the clearest portrait available and write the name, dates, scripture or remembrance message exactly as you want them printed. Identify the main photo and explain any supporting photos, background or family references.",
    choice: "Confirm the required dimensions and any cemetery or venue requirements before ordering. Check how the cover will be positioned and secured. Review names, dates, portrait placement and wording in your proof, and ask the team about a time-sensitive service date.",
    galleryLabel: "Browse grave cover designs",
    questions: [
      { question: "Can I order a personalised grave cover for an unveiling?", answer: "Yes. Check the available space and any cemetery requirements for a 100 × 200 cm cover. Send the photos and exact wording you want, and let us know the date before relying on delivery." },
      { question: "What can I put on a memorial grave cover?", answer: "You can provide a portrait, a name, dates, scripture or a remembrance message. Use the proof to check the spelling and layout before printing." },
    ],
  },
  "digital-oil-painting-banner": {
    heading: "Plan a funeral or celebration of life photo banner",
    explanation: "A wide memorial photo banner gives people a portrait to gather around during a service, wake or celebration of life. The design uses your photo as the reference for a painterly image.",
    preparation: "Identify the main portrait and send the best original file or scan you have. Include the exact name, dates and remembrance wording, and let us know if another photo helps show their features.",
    choice: "Check the space where the backdrop will hang and choose a size from the options above. If you need an upright display at the entrance, compare the roll-up format. Check the portrait and wording before approving the proof.",
    galleryLabel: "Browse painterly banner designs",
    questions: [
      { question: "What should I send for a funeral photo banner?", answer: "Send a clear portrait, the name and dates as you want them printed, and any scripture or remembrance message. Include the service date and delivery location so we can check timing." },
      { question: "What is the difference between a funeral backdrop and a standing banner?", answer: "A wall banner is wide and hangs behind the display. A roll-up banner has a stand and fits an entrance or a smaller floor area." },
    ],
  },
  "banner-bundle": {
    heading: "Order a matching roll-up and wall banner for one event",
    explanation: "Use a standing banner at the entrance and a wide wall banner as the backdrop. The package combines an 85 × 200 cm roll-up banner and a wall banner with artwork fitted to each format.",
    preparation: "Send your colour references, main portrait and event wording. Tell us which photos and text should appear on each banner and which details should tie the pair together.",
    choice: "Check the height and floor space for the roll-up display, and the width and hanging points for the wall banner. Check both layouts before approving printing.",
    galleryLabel: "Browse designs for your event",
    questions: [
      { question: "Can the two banners have different photos or wording?", answer: "Yes. Each format is customised separately. Tell us what belongs on each piece and whether you want common colours, a matching portrait or different photos." },
      { question: "Which banner should go at the entrance and which works as a backdrop?", answer: "The freestanding roll-up fits at the entrance. The wide fabric wall banner works as a backdrop if your venue has suitable hanging points." },
    ],
  },
};

export function hasProductBuyingGuide(product: Product) {
  return Boolean(buyingGuides[product.key]);
}

export function ProductBuyingGuide({ product, artwork, market }: Readonly<{
  product: Product;
  artwork: readonly PublicGalleryItem[];
  market: Market;
}>) {
  const content = buyingGuides[product.key];
  if (!content) return null;
  const deliveryMarket = market === "AU" ? "Australia" : "New Zealand";
  const galleryHref = product.key === "banner-bundle"
    ? "/design-gallery?design_type=roll-up-banner&design_type=wall-hanging-banners"
    : `/design-gallery?product=${product.slug}`;
  return <section className={guide.section} aria-labelledby="product-buying-guide">
    <h2 id="product-buying-guide">{content.heading}</h2>
    <p>{content.explanation}</p>
    <div className={guide.comparison}>
      <div className={guide.option}><h3>Photos and wording to prepare</h3><p>{content.preparation}</p></div>
      <div className={guide.option}><h3>Check the format before ordering</h3><p>{content.choice}</p></div>
    </div>
    {artwork.length ? <>
      <h3>Published design examples</h3>
      <p>Explore an existing design for inspiration, then supply your own photos and wording for your order.</p>
      <div className={styles.galleryGrid}>{artwork.map((item) =>
        <article className={styles.galleryCard} key={item.id}>
          <Link className={`${styles.galleryCardLink} ${guide.artworkLink}`} href={`/designs/${item.publicSlug}`} prefetch={false}>
            <div className={styles.galleryCardMedia}>
              <Image src={`/gallery-images/${item.id}?v=${item.contentHash}`} alt={item.altText}
                width={item.width} height={item.height} loading="lazy"
                sizes="(max-width: 767px) 92vw, (max-width: 1179px) 45vw, 30vw" />
            </div>
            <div className={styles.galleryCardBody}><h3 className={guide.artworkTitle}>{item.displayTitle}</h3><span className={styles.galleryCardAction}>View design</span></div>
          </Link>
        </article>,
      )}</div>
    </> : null}
    <h3>Questions about ordering</h3>
    <dl className={guide.comparison}>
      {content.questions.map(({ question, answer }) => (
        <div className={guide.option} key={question}>
          <dt>{question}</dt>
          <dd>{answer}</dd>
        </div>
      ))}
    </dl>
    <ul className={guide.productLinks}>
      <li><Link href={galleryHref} prefetch={false}>{content.galleryLabel}</Link></li>
      {product.category === "canvas" ? <li><Link href={market === "AU" ? "/au/canvas" : "/canvas"} prefetch={false}>Compare canvas artwork options</Link></li> : <>
        {product.key !== "grave-cover" ? <li><Link href="/birthday-banners" prefetch={false}>Photo birthday banner ideas</Link></li> : null}
        {product.key !== "custom-themed-wall-banner" ? <li><Link href="/memorial-banners" prefetch={false}>Memorial and funeral display ideas</Link></li> : null}
      </>}
      <li><Link href="/shipping-delivery" prefetch={false}>Delivery estimates for {deliveryMarket}</Link></li>
      <li><Link href="/contact" prefetch={false}>Ask about your photos or event date</Link></li>
    </ul>
  </section>;
}
