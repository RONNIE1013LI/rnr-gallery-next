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
}>>> = {
  "digital-oil-painting-canvas": {
    heading: "Turn a photo into a digital painting on canvas",
    explanation: "Your photos are used to create a painterly portrait, then the digital artwork is printed on canvas. This is a digital oil painting effect, not an oil painting applied by hand. For a photograph printed without this portrait treatment, choose Photo Print Canvas instead.",
    preparation: "Upload the clearest original photo files you have. Identify the main portrait and tell us which people, pets, background and wording you want included. If you want people brought together from separate photographs, supply each original and explain the composition you have in mind.",
    choice: "Check the available canvas sizes above and measure your display space. The selected size and artwork options determine the price. You review the design proof before printing, including the faces, composition and any spelling.",
    galleryLabel: "Browse digital portrait designs",
  },
  "custom-themed-wall-banner": {
    heading: "Plan your personalised photo birthday banner",
    explanation: "A fabric wall banner creates a wide display for a birthday cake area, party backdrop or event wall. Your photos, name, age and wording become one custom design. It needs a suitable place to hang; a roll-up banner is the standing alternative.",
    preparation: "Send original photos separately and identify the main portrait. Include the exact name, age, message and colour direction, plus any reference ideas. For several photos, explain which images should be most prominent.",
    choice: "Measure the wall and check the available sizes above before choosing. Allow space for hanging at the reinforced corner eyelets. Review the photo layout and all wording in your proof before approving printing.",
    galleryLabel: "Browse wall banner designs",
  },
  "roll-up-banner": {
    heading: "Choose a personalised roll-up banner for your event",
    explanation: "This upright display includes an 85 × 200 cm printed banner, stand, carry bag, pegs and box. It suits an entrance or event display when you want a standing banner, including birthday and memorial designs.",
    preparation: "Choose a clear main portrait and send your original photos, exact names, dates and message. Tell us which wording should be read from a distance and share any colours or design references you want considered.",
    choice: "Check the height and available floor space at your venue. If you need a wide backdrop instead, compare the wall banner format. Review the layout and spelling in the design proof; confirm any close event deadline with the team before ordering.",
    galleryLabel: "Browse roll-up banner designs",
  },
  "grave-cover": {
    heading: "Prepare a personalised memorial grave cover",
    explanation: "A grave cover is a separate graveside tribute format, rather than a standing funeral banner. This custom 100 × 200 cm cover includes personalised artwork and reinforced eyelets.",
    preparation: "Supply the clearest portrait available and write the name, dates, scripture or remembrance message exactly as you want them printed. Identify the main photo and explain any supporting photos, background or family references.",
    choice: "Confirm the required dimensions and any cemetery or venue requirements before ordering. Check how the cover will be positioned and secured. Review names, dates, portrait placement and wording in your proof, and ask the team about a time-sensitive service date.",
    galleryLabel: "Browse grave cover designs",
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
    <ul className={guide.productLinks}>
      <li><Link href={`/design-gallery?product=${product.slug}`} prefetch={false}>{content.galleryLabel}</Link></li>
      {product.category === "canvas" ? <li><Link href={market === "AU" ? "/au/canvas" : "/canvas"} prefetch={false}>Compare canvas artwork options</Link></li> : <>
        {product.key !== "grave-cover" ? <li><Link href="/birthday-banners" prefetch={false}>Photo birthday banner ideas</Link></li> : null}
        {product.key !== "custom-themed-wall-banner" ? <li><Link href="/memorial-banners" prefetch={false}>Memorial and funeral display ideas</Link></li> : null}
      </>}
      <li><Link href="/contact" prefetch={false}>Ask about your photos or event date</Link></li>
    </ul>
  </section>;
}
