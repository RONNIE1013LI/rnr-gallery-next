import Link from "next/link";
import type { Market } from "@/domain/markets/types";
import styles from "./catalogue-seo.module.css";

type CatalogueBuyingGuideProps = Readonly<{
  category: "canvas" | "banners";
  market: Market;
}>;

/** Market-specific buying guidance; product options and prices stay in the registry. */
export function CatalogueBuyingGuide({ category, market }: CatalogueBuyingGuideProps) {
  const headingId = `${category}-buying-guide`;

  if (category === "canvas") {
    if (market === "AU") {
      return (
        <section className={styles.section} aria-labelledby={headingId}>
          <h2 id={headingId}>Choosing personalised canvas for Australia</h2>
          <p>
            Start with the result you want: a favourite photograph printed on canvas,
            a painterly portrait, or a design combining photos and wording. These are
            different artwork options, not simply different names for the same print.
          </p>
          <h3>Photo print, digital painting or themed artwork?</h3>
          <p>
            Photo Print Canvas keeps your complete photograph as the artwork on a
            gallery-wrapped canvas. Digital Oil Painting Canvas gives photos a
            painterly portrait treatment. It is digital artwork printed on canvas,
            rather than an oil painting applied by hand to the canvas.
          </p>
          <p>
            Custom Themed Canvas brings photos, names and meaningful wording into
            one composition. It suits family artwork, birthday gifts and memorial
            designs when you want more than a single photograph. For the photographic
            option, review the{" "}
            <Link href="/au/products/photo-print-canvas" prefetch={false}>photo canvas product details</Link>.
          </p>
          <h3>Prepare your photos and compare the options</h3>
          <p>
            Keep the original photo files where possible, rather than screenshots,
            and decide which people, wording and background matter to your design.
            Compare the available product options before choosing a size. Prices are
            shown in AUD, and the selected configuration determines the order price.
          </p>
          <p>
            Browse the{" "}
            <Link href="/design-gallery" prefetch={false}>design gallery</Link>{" "}
            for ideas, then use Create Your Artwork on your chosen product to start.
            For questions about your photos, delivery location or required date,{" "}
            <Link href="/contact" prefetch={false}>contact R&amp;R Gallery</Link>{" "}
            before ordering.
          </p>
        </section>
      );
    }

    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <h2 id={headingId}>Choosing your personalised canvas</h2>
        <p>
          Start with the result you want: a favourite photograph printed on canvas,
          a painterly portrait, or a design combining photos and wording. These
          are different artwork options, not simply different names for the same print.
        </p>
        <h3>Photo print, digital painting or themed artwork?</h3>
        <p>
          Photo Print Canvas keeps your complete photograph as the artwork on a
          gallery-wrapped canvas. Digital Oil Painting Canvas gives photos a
          painterly portrait treatment. It is digital artwork printed on canvas,
          rather than an oil painting applied by hand to the canvas.
        </p>
        <p>
          Custom Themed Canvas brings photos, names and meaningful wording into
          one composition. It is an option for family artwork, a birthday gift,
          or a memorial design when you want more than a single photograph.
          For the photographic option, read our{" "}
          <Link href="/custom-photo-canvas-nz" prefetch={false}>photo canvas guide</Link>.
        </p>
        <h3>Prepare your photos and compare the options</h3>
        <p>
          Keep the original photo files where possible, rather than screenshots,
          and decide which people, wording and background matter to your design.
          Compare the available options on the product pages before choosing a size.
          The listed starting prices are for each product; your chosen configuration
          determines the order price.
        </p>
        <p>
          Browse the{" "}
          <Link href="/design-gallery" prefetch={false}>design gallery</Link>{" "}
          for ideas, then use Create Your Artwork on your chosen product to start.
          For questions about your photos or a required delivery date,{" "}
          <Link href="/contact" prefetch={false}>contact R&amp;R Gallery</Link>{" "}
          before placing the order.
        </p>
      </section>
    );
  }

  if (market === "AU") {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <h2 id={headingId}>Choosing a banner for Australia</h2>
        <p>
          Choose the display format first, then plan the photos, names and wording.
          A standing welcome display, a wide wall backdrop and a graveside cover
          serve different purposes, even when they share a matching design.
        </p>
        <h3>Standing display or wall backdrop?</h3>
        <p>
          A roll-up banner has its own display base for an entrance or event space.
          A fabric wall banner is designed to hang as a larger backdrop. Compare the{" "}
          <Link href="/au/products/roll-up-banner" prefetch={false}>roll-up banner details</Link>{" "}
          with the{" "}
          <Link href="/au/products/custom-themed-wall-banner" prefetch={false}>wall banner details</Link>{" "}
          to choose the format that suits your venue.
        </p>
        <p>
          The{" "}
          <Link href="/au/products/banner-bundle" prefetch={false}>banner bundle details</Link>{" "}
          cover a matching roll-up and wall banner package. The{" "}
          <Link href="/au/products/grave-cover" prefetch={false}>grave cover details</Link>{" "}
          explain a separate format for a graveside tribute rather than a standing display.
        </p>
        <h3>Birthday, memorial and event designs</h3>
        <p>
          Choose the product format that fits the occasion, then prepare the clearest
          original photos and the exact names or wording you want included. The
          product pages show the options available to Australian customers and the
          starting prices in AUD.
        </p>
        <p>
          Confirm your display space before selecting a size. For a time-sensitive
          event or questions about delivery to your location,{" "}
          <Link href="/contact" prefetch={false}>contact R&amp;R Gallery</Link>{" "}
          before ordering.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>Choosing a banner for your occasion</h2>
      <p>
        Choose the display format first, then plan the photos, names and wording.
        A standing welcome display, a wide wall backdrop and a graveside cover
        serve different purposes, even when they share a matching design.
      </p>
      <h3>Standing display or wall backdrop?</h3>
      <p>
        A roll-up banner has its own display base and can stand at an entrance
        or beside an event space. A fabric wall banner is designed to hang as
        a larger backdrop. Compare the{" "}
        <Link href="/custom-roll-up-banners-nz" prefetch={false}>roll-up banner guide</Link>{" "}
        with the{" "}
        <Link href="/custom-wall-banners-nz" prefetch={false}>wall banner guide</Link>{" "}
        to choose the format that suits your venue.
      </p>
      <p>
        The Banner Bundle combines a roll-up banner with a matching wall banner.
        A Grave Cover is a separate product for a graveside tribute, rather than
        a substitute for a standing display. Check each product page for its
        available options and what is included.
      </p>
      <h3>Birthday, memorial and event designs</h3>
      <p>
        Explore{" "}
        <Link href="/birthday-banners" prefetch={false}>personalised birthday banners</Link>{" "}
        for celebration ideas, or{" "}
        <Link href="/memorial-banners" prefetch={false}>memorial and funeral banners</Link>{" "}
        for tribute designs. Decide on the photos and wording you want to include
        before you start the customisation process.
      </p>
      <p>
        Confirm your available display space before selecting a size. For a
        time-sensitive event or questions about the right format,{" "}
        <Link href="/contact" prefetch={false}>contact R&amp;R Gallery</Link>{" "}
        with your event date and delivery location before ordering.
      </p>
    </section>
  );
}
