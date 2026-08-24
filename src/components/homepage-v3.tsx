import Image from "next/image";
import Link from "next/link";
import { FaFacebookMessenger } from "react-icons/fa";
import { StructuredData } from "@/components/structured-data";
import {
  getRegistryProducts,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import {
  buildPublicDesignSlug,
  publicDesignTitle,
} from "@/domain/gallery/public-design-slug";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import type { Market } from "@/domain/markets/types";
import type { PublicCustomerReviewSection } from "@/domain/customer-reviews/types";
import { getSiteUrl } from "@/server/seo/site-url";
import {
  selectHomepageGalleryItems,
  type HomepageGallerySlot,
} from "./homepage-gallery";
import { ProofConversationScroller } from "./proof-conversation-scroller";
import { HomepageFaq } from "./homepage-faq";
import { CustomerReviewsSection } from "./customer-reviews/customer-reviews-section";
import { homepageV3ImageSlots, type HomepageV3ImageSlot } from "./homepage-v3-images";
import styles from "./homepage-v3.module.css";

type ArtworkProps = Readonly<{
  slot: HomepageV3ImageSlot;
  tone: "sage" | "clay" | "sand" | "blue" | "olive" | "rose";
  ratio?: "four-three" | "three-four" | "three-five" | "five-four" | "four-five" | "portrait";
  people?: 1 | 2 | 3 | 4;
  label?: string;
  darkLabel?: boolean;
  ratioTag?: string;
  className?: string;
  sizes?: string;
  productRatio?: string;
  preload?: boolean;
}>;

function Artwork({
  slot,
  tone,
  ratio = "four-three",
  people = 2,
  label,
  darkLabel = false,
  ratioTag,
  className = "",
  sizes = "(max-width: 760px) 100vw, 40vw",
  productRatio,
  preload = false,
}: ArtworkProps) {
  const ratioClass = ratio === "three-four"
    ? styles.ratioThreeFour
    : ratio === "three-five"
      ? styles.ratioThreeFive
    : ratio === "five-four"
      ? styles.ratioFiveFour
      : ratio === "four-five"
        ? styles.ratioFourFive
        : ratio === "portrait"
          ? styles.portrait
          : styles.ratioFourThree;
  const toneClass = {
    sage: styles.artworkSage,
    clay: styles.artworkClay,
    sand: styles.artworkSand,
    blue: styles.artworkBlue,
    olive: styles.artworkOlive,
    rose: styles.artworkRose,
  }[tone];

  return (
    <div
      className={`${styles.artwork} ${toneClass} ${ratioClass} ${className}`}
      role={slot.src ? undefined : "img"}
      aria-label={slot.src ? undefined : slot.alt}
      data-product-ratio={productRatio}
    >
      {slot.src ? (
        <Image
          src={slot.src}
          alt={slot.alt}
          fill
          sizes={sizes}
          preload={preload}
          loading={preload ? undefined : "lazy"}
          fetchPriority={preload ? "high" : undefined}
        />
      ) : (
        <span className={styles.people} aria-hidden="true">
          {Array.from({ length: people }, (_, index) => <i key={index} />)}
        </span>
      )}
      {label ? (
        <span className={`${styles.mediaLabel}${darkLabel ? ` ${styles.mediaLabelDark}` : ""}`}>
          {label}
        </span>
      ) : null}
      {ratioTag ? <span className={styles.ratioTag}>{ratioTag}</span> : null}
    </div>
  );
}

const Arrow = () => <span aria-hidden="true">→</span>;

function GalleryArtworkCard({
  item,
  slot,
  label,
  className,
  sizes,
}: Readonly<{
  item: PublicGalleryItem;
  slot: HomepageGallerySlot;
  label: string;
  className: string;
  sizes: string;
}>) {
  return (
    <Link
      aria-label={`View design details: ${item.altText}`}
      className={`${styles.galleryCard} ${className}`}
      data-homepage-gallery-slot={slot}
      href={`/designs/${buildPublicDesignSlug(publicDesignTitle(item), item.id)}`}
    >
      <figure className={styles.galleryFigure}>
        <div className={styles.galleryRealMedia}>
          <Image
            src={`/gallery-images/${item.id}?v=${item.contentHash}`}
            alt={item.altText}
            width={item.width}
            height={item.height}
            sizes={sizes}
            quality={60}
            loading="lazy"
          />
        </div>
        <figcaption className={styles.galleryProductLabel}>{label}</figcaption>
      </figure>
    </Link>
  );
}

export function HomepageV3({
  registry,
  galleryItems = [],
  market = "NZ",
  reviewSection = null,
}: Readonly<{
  registry: ProductRegistryDocument;
  galleryItems?: readonly PublicGalleryItem[];
  market?: Market;
  reviewSection?: PublicCustomerReviewSection | null;
}>) {
  const products = getRegistryProducts(registry);
  const shopHref = market === "AU" ? "/au/shop" : "/shop";
  const canvasHref = market === "AU" ? "/au/canvas" : "/canvas";
  const configureHref = (slug: string) => `${market === "AU" ? "/au" : ""}/products/${slug}/configure`;
  const homepageGalleryItems = selectHomepageGalleryItems(galleryItems);
  const galleryClassNames: Readonly<Record<HomepageGallerySlot, string>> = {
    "canvas-landscape": styles.galleryCanvasLandscape,
    "canvas-portrait": styles.galleryCanvasPortrait,
    "wall-banner": styles.galleryWall,
    "grave-cover": styles.galleryGrave,
    "roll-up-banner": styles.galleryRollup,
  };
  const gallerySizes: Readonly<Record<HomepageGallerySlot, string>> = {
    "canvas-landscape": "(max-width: 760px) 57vw, 422px",
    "canvas-portrait": "(max-width: 760px) 28vw, 210px",
    "wall-banner": "(max-width: 760px) calc(100vw - 3rem), 648px",
    "grave-cover": "(max-width: 760px) 46vw, 320px",
    "roll-up-banner": "(max-width: 760px) 38vw, 269px",
  };
  const galleryLabels: Readonly<Record<HomepageGallerySlot, string>> = {
    "canvas-landscape": "Canvas",
    "canvas-portrait": "Canvas",
    "wall-banner": "Wall Banner",
    "grave-cover": "Grave Cover",
    "roll-up-banner": "Roll-up Banner",
  };
  const renderGalleryArtwork = (slot: HomepageGallerySlot) => {
    const selection = homepageGalleryItems.find((candidate) => candidate.slot === slot);
    return selection ? (
      <GalleryArtworkCard
        key={selection.item.id}
        {...selection}
        label={galleryLabels[slot]}
        className={galleryClassNames[slot]}
        sizes={gallerySizes[slot]}
      />
    ) : null;
  };
  const hasActiveProduct = (slug: string) => products.some(
    (product) => product.slug === slug && product.active,
  );
  const hasActiveCanvas = products.some(
    (product) => product.category === "canvas" && product.active,
  );

  return (
    <main id="main-content" className={styles.page}>
      <StructuredData id="rnr-local-business" data={{
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: "R&R Gallery",
        url: getSiteUrl().toString(),
        image: new URL(
          "/media/home/digital-oil-painting-canvas-hero-landscape-01.webp",
          getSiteUrl(),
        ).toString(),
        email: "customerservice@rnrgallery.com",
        telephone: "+64 21 023 48948",
        address: {
          "@type": "PostalAddress",
          streetAddress: "11 Para Close",
          addressLocality: "Fairview Heights",
          addressRegion: "Auckland",
          postalCode: "0632",
          addressCountry: "NZ",
        },
        areaServed: ["New Zealand", "Australia"],
      }} />
      <StructuredData id="rnr-website" data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "R&R Gallery",
        url: getSiteUrl().toString(),
      }} />

      <section className={`${styles.hero} ${styles.sectionPaper}`}>
        <div className={`${styles.shell} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>CUSTOM STORY &amp; ARTWORK STUDIO</p>
            <h1>From the photos you have<br />{" "}to the piece you imagined.</h1>
            <p className={styles.lede}>
              Custom canvas, banners and memorial artwork, thoughtfully designed
              from your photos and approved by you before printing.
            </p>
            <div className={styles.heroActions}>
              <Link className={`${styles.button} ${styles.buttonPrimary}`} href={shopHref}>
                Start With Your Photos
              </Link>
              <a className={styles.textLink} href="#transformation">
                See Real Transformations <Arrow />
              </a>
            </div>
            <p className={styles.microcopy}>
              You don&apos;t need perfect photos. We&apos;ll help you choose the right format.
            </p>
          </div>

          <div className={styles.heroArt} aria-label="Finished artwork shown in a real customer setting and as a printed canvas">
            <figure className={styles.realMomentCard}>
              <Artwork
                slot={homepageV3ImageSlots.heroRealMoment}
                tone="sand"
                ratio="three-four"
                label="REAL MOMENT"
                sizes="(max-width: 760px) 34vw, 14rem"
              />
            </figure>
            <figure className={styles.finalArtCard}>
              <Artwork
                slot={homepageV3ImageSlots.heroFinishedArtwork}
                tone="sage"
                people={4}
                label="FINISHED ARTWORK"
                darkLabel
                sizes="(max-width: 760px) 94vw, 35rem"
                preload
              />
            </figure>
            <figure className={styles.printedCard}>
              <Artwork
                slot={homepageV3ImageSlots.heroPrintedProduct}
                tone="rose"
                people={4}
                label="PRINTED CANVAS"
                sizes="(max-width: 760px) 43vw, 16rem"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className={styles.trustStrip} aria-label="Service reassurance">
        <div className={`${styles.shell} ${styles.trustGrid}`}>
          <div className={styles.trustItem}>
            <strong>DESIGNER-LED. APPROVED BY YOU.</strong>
            <span className={styles.trustCopyDesktop}>Every artwork is reviewed and refined by our team before printing.</span>
            <span className={styles.trustCopyMobile}>Reviewed and refined by our team before printing.</span>
          </div>
          <div className={styles.trustItem}>
            <strong>PROOF BEFORE PRINTING</strong>
            <span className={styles.trustCopyDesktop}>Review the design and request up to two free revisions.</span>
            <span className={styles.trustCopyMobile}>Review your proof with two free revisions.</span>
          </div>
          <div className={styles.trustItem}>
            <strong>NZ &amp; AU DELIVERY</strong>
            <span className={styles.trustCopyDesktop}>Delivery options are available for New Zealand and Australia.</span>
            <span className={styles.trustCopyMobile}>Delivery across New Zealand and Australia.</span>
          </div>
          <div className={styles.trustItem}>
            <strong>REAL CUSTOMER SUPPORT</strong>
            <span className={styles.trustCopyDesktop}>Help choosing photos, wording and format.</span>
            <span className={styles.trustCopyMobile}>Help with photos, wording and format.</span>
          </div>
        </div>
      </section>

      <section id="gallery" className={`${styles.gallerySection} ${styles.sectionWarm}`}>
        <div className={styles.shell}>
          <div className={`${styles.sectionHeading} ${styles.galleryHeading}`}>
            <h2>Real designs across every format.</h2>
            <p>Explore finished Canvas, Wall Banner, Roll-up Banner and Grave Cover designs created by R&amp;R Gallery.</p>
          </div>
          <nav className={styles.filterRow} aria-label="Design gallery products">
            <Link className={styles.filter} href="/design-gallery?design_type=canvas">Canvas</Link>
            <Link className={styles.filter} href="/design-gallery?design_type=wall-hanging-banners">Wall Banner</Link>
            <Link className={styles.filter} href="/design-gallery?design_type=roll-up-banner">Roll-up Banner</Link>
            <Link className={styles.filter} href="/design-gallery?design_type=grave-cover">Grave Cover</Link>
          </nav>
          <div className={styles.galleryMosaic}>
            <div className={styles.galleryLeftColumn}>
              <div className={styles.galleryCanvasRow}>
                {renderGalleryArtwork("canvas-landscape")}
                {renderGalleryArtwork("canvas-portrait")}
              </div>
              {renderGalleryArtwork("wall-banner")}
            </div>
            {renderGalleryArtwork("grave-cover")}
            {renderGalleryArtwork("roll-up-banner")}
          </div>
          <Link className={`${styles.textLink} ${styles.galleryLink}`} href="/design-gallery">View the full gallery <Arrow /></Link>
        </div>
      </section>

      <section id="begin" className={`${styles.productsSection} ${styles.sectionPaper}`}>
        <div className={styles.productsBackdrop} aria-hidden="true">
          <div className={styles.productsBackdropImage} />
        </div>
        <div className={styles.shell}>
          <span id="products" className={styles.compatAnchor} aria-hidden="true" />
          <div className={`${styles.sectionHeading} ${styles.productHeading}`}>
            <h2>Find the right way to begin.</h2>
            <p>Choose a product directly, or start with the occasion and photos you have.</p>
          </div>
          <div className={styles.productEditorialGrid}>
            {hasActiveCanvas ? (
              <article className={styles.productFeature}>
                <Artwork slot={homepageV3ImageSlots.canvasProductImage} tone="sage" ratio="five-four" people={4} className={styles.productMedia} productRatio="canvas-5-4" />
                <div className={styles.productCopy}><h3>Custom Canvas</h3><p>For family portraits, memorial compositions and artwork designed to live in the home.</p><Link className={styles.textLink} href={canvasHref}>Shop Custom Canvas <Arrow /></Link></div>
              </article>
            ) : null}
            {hasActiveProduct("custom-themed-wall-banner") ? (
              <article className={styles.productFeature}>
                <Artwork slot={homepageV3ImageSlots.wallBannerProductImage} tone="clay" ratio="five-four" people={4} className={styles.productMedia} productRatio="wall-banner-5-4" />
                <div className={styles.productCopy}><h3>Wall Banner</h3><p>A large horizontal format for birthdays, memorials, family events and cultural celebrations.</p><Link className={styles.textLink} href={configureHref("custom-themed-wall-banner")}>Shop Wall Banners <Arrow /></Link></div>
              </article>
            ) : null}
            {hasActiveProduct("roll-up-banner") ? (
              <article className={styles.productVertical}>
                <Artwork slot={homepageV3ImageSlots.rollupProductImage} tone="blue" ratio="four-five" people={2} className={styles.productMedia} productRatio="roll-up-4-5" sizes="380px" />
                <div className={styles.productCopy}><h3>Roll-up Banner</h3><p>A custom-designed 85 × 200 cm printed roll-up banner supplied with its stand, carry bag, pegs and box.</p><Link className={styles.textLink} href={configureHref("roll-up-banner")}>Shop Roll-up Banners <Arrow /></Link></div>
              </article>
            ) : null}
            {hasActiveProduct("grave-cover") ? (
              <article className={styles.productVertical}>
                <Artwork slot={homepageV3ImageSlots.graveCoverProductImage} tone="olive" ratio="four-five" people={2} className={styles.productMedia} productRatio="grave-cover-4-5" sizes="380px" />
                <div className={styles.productCopy}><h3>Grave Cover</h3><p>A complete 100 cm × 200 cm vertical memorial format shown without horizontal cropping.</p><Link className={styles.textLink} href={configureHref("grave-cover")}>Shop Grave Covers <Arrow /></Link></div>
              </article>
            ) : null}
          </div>
          <Link className={`${styles.textLink} ${styles.viewAllProducts}`} href={shopHref}>View all products <Arrow /></Link>
          <div className={styles.discoverySupport} aria-label="Other ways to begin">
            <article className={styles.discoverySupportItem}>
              <p className={styles.eyebrow}>BROWSE BY OCCASION</p>
              <h3>Start with the moment.</h3>
              <p>Explore birthday, memorial, family, cultural and children&apos;s ideas in the Design Gallery.</p>
              <a className={styles.textLink} href="/design-gallery?filters=1#browse-by-occasion">Browse by occasion <Arrow /></a>
            </article>
            <article className={styles.discoverySupportItem}>
              <p className={styles.eyebrow}>START WITH YOUR PHOTOS</p>
              <h3>Use the photos you have.</h3>
              <p>You don&apos;t need perfect photos. We&apos;ll help you choose a suitable product and format.</p>
              <Link className={styles.textLink} href={shopHref}>Start with your photos <Arrow /></Link>
            </article>
            <article className={styles.discoverySupportItem}>
              <p className={styles.eyebrow}>DESIGN HELP</p>
              <h3>Ask R&amp;R Gallery.</h3>
              <p>Send your photos or idea by Messenger and we&apos;ll explain a clear next step.</p>
              <a className={styles.textLink} href="https://m.me/RandRgallery" rel="noopener noreferrer">Get Design Help <Arrow /></a>
            </article>
          </div>
        </div>
      </section>

      <section id="transformation" className={`${styles.transformationSection} ${styles.sectionDark}`}>
        <div className={styles.shell}>
          <p className={`${styles.eyebrow} ${styles.eyebrowLight} ${styles.transformationEyebrow}`}>SIGNATURE TRANSFORMATION</p>
          <div className={styles.transformationGrid}>
            <div className={styles.transformationIntro}>
              <h2>Three photographs.<br />One family piece.</h2>
              <p>See the starting photographs, the refinements completed by R&amp;R Gallery and the final printed result.</p>
              <div className={styles.rawPhotoCollage}>
                {homepageV3ImageSlots.signatureOriginalPhotos.map((imageSlot, index) => (
                  <Artwork
                    key={imageSlot.alt}
                    slot={imageSlot}
                    tone={index === 0 ? "sand" : index === 1 ? "blue" : "clay"}
                    people={index === 1 ? 2 : 1}
                    label={`PHOTO 0${index + 1}`}
                    className={`${styles.rawPhoto} ${index === 0 ? styles.rawOne : index === 1 ? styles.rawTwo : styles.rawThree}`}
                  />
                ))}
              </div>
              <span className={styles.darkCaption}>THE PHOTOS PROVIDED</span>
            </div>
            <div className={styles.workList} aria-label="Design work completed">
              <div className={styles.workItem}><span>01</span><strong>People combined naturally</strong></div>
              <div className={styles.workItem}><span>02</span><strong>Background cleaned and rebuilt</strong></div>
              <div className={styles.workItem}><span>03</span><strong>Positioning, clothing and detail refined</strong></div>
              <div className={styles.workItem}><span>04</span><strong>Personal wording and cultural elements added</strong></div>
              <p className={styles.workNote}>Every artwork is reviewed and refined by our team before printing.</p>
            </div>
            <div className={styles.transformationResult}>
              <Artwork slot={homepageV3ImageSlots.signatureFinishedArtwork} tone="sage" ratio="five-four" people={4} label="FINAL ARTWORK" darkLabel className={styles.resultArt} />
              <h3>Finished as a custom family canvas</h3>
              <p>3 source photos · Custom background · Proof approved before print</p>
            </div>
          </div>
        </div>
      </section>

      <section id="process" className={`${styles.peopleSection} ${styles.sectionWhite}`}>
        <div className={`${styles.shell} ${styles.peopleGrid}`}>
          <div className={styles.peopleCopy}>
            <p className={styles.eyebrow}>THE R&amp;R GALLERY DIFFERENCE</p>
            <h2>Designer-led.<br />Approved by you.</h2>
            <p>Every artwork is reviewed and refined by our team before printing. You see the design proof and approve the version that moves into production.</p>
            <a className={`${styles.button} ${styles.buttonOutline}`} href="#faq">See How It Works</a>
          </div>
          <div className={styles.proofPanel}>
            <div className={styles.proofHeader}><span>YOUR DESIGN PROOF</span></div>
            <div className={styles.proofLayout}>
              <div className={styles.proofVisualColumn}>
                <ProofConversationScroller className={styles.proofConversation} />
                <div className={styles.approvedBox}><small>APPROVED FOR PRINT</small><strong>The customer confirms the exact version that will be printed.</strong></div>
              </div>
              <ol className={styles.proofSteps}>
                <li><span>01</span><div><strong>Tell us your idea</strong><p>Upload photos and explain the people, wording, occasion and style.</p></div></li>
                <li><span>02</span><div><strong>We create the artwork</strong><p>Our team prepares the composition, layout and background.</p></div></li>
                <li><span>03</span><div><strong>You review the proof</strong><p>Two free design revisions are included. List requested changes together to avoid an additional fee.</p></div></li>
                <li><span>04</span><div><strong>We print and deliver</strong><p>Only the approved design moves into production and delivery.</p></div></li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {reviewSection ? <CustomerReviewsSection data={reviewSection} /> : null}

      <section id="faq" className={`${styles.faqSection} ${styles.sectionWhite}`}>
        <div className={`${styles.shell} ${styles.faqGrid}`}>
          <div className={styles.faqIntro}>
            <h2>Questions customers ask before uploading.</h2>
            <p className={styles.faqDescription}>Clear answers about photo quality, combining people, revisions, production and choosing the right format.</p>
            <div className={styles.faqContact}>
              <p>Have more questions? Find R&amp;R Gallery on Facebook or click below to message us. Our team will reply as soon as possible.</p>
              <a
                className={`${styles.button} ${styles.buttonOutline} ${styles.faqContactButton}`}
                href="https://m.me/RandRgallery"
                rel="noopener noreferrer"
              >
                <FaFacebookMessenger aria-hidden="true" focusable="false" />
                Message R&amp;R
              </a>
            </div>
          </div>
          <HomepageFaq />
        </div>
      </section>

      <section id="final-cta" className={`${styles.finalCta} ${styles.sectionDark}`}>
        <div className={`${styles.shell} ${styles.finalCtaGrid}`}>
          <div><p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>A PLACE TO START</p><h2>You don&apos;t need perfect photos.<br />You just need a place to start.</h2><p>Upload what you have, tell us what the piece is for, and we&apos;ll guide you from there.</p></div>
          <div className={styles.finalActions}><Link className={`${styles.button} ${styles.buttonLight}`} href={shopHref}>Start With Your Photos</Link><a className={`${styles.textLink} ${styles.textLinkLight}`} href="#products">Get product guidance <Arrow /></a></div>
        </div>
      </section>
    </main>
  );
}
