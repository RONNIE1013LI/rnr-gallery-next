import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import type { AdLandingPageContent } from "@/domain/ads/landing-pages";
import { formatNzd } from "@/domain/money";
import { buildBreadcrumbData } from "@/server/seo/metadata";
import { getSiteUrl } from "@/server/seo/site-url";
import { PurchaseTrustStrip } from "./purchase-trust-strip";
import { StructuredData } from "./structured-data";
import { AnalyticsLink } from "./analytics-link";
import styles from "./storefront.module.css";

export function AdLandingPage({ content, product, priceInclGstCents }: Readonly<{
  content: AdLandingPageContent;
  product: Product;
  priceInclGstCents: number;
}>) {
  const siteUrl = getSiteUrl();
  const configureHref = `/products/${product.slug}/configure`;
  return (
    <main id="main-content" className={styles.adLandingPage}>
      <StructuredData id="rnr-landing-product" data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.title,
        description: content.description,
        image: [new URL(product.image.src, siteUrl).toString()],
        brand: { "@type": "Brand", name: "R&R Gallery" },
        offers: {
          "@type": "Offer",
          url: new URL(content.path, siteUrl).toString(),
          priceCurrency: "NZD",
          price: (priceInclGstCents / 100).toFixed(2),
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      }} />
      <StructuredData id="rnr-landing-breadcrumbs" data={buildBreadcrumbData([
        { name: "Home", path: "/" },
        { name: product.title, path: content.path },
      ])} />

      <nav className={styles.publicBreadcrumbs} aria-label="Breadcrumb">
        <Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{product.title}</span>
      </nav>
      <section className={styles.adLandingHero}>
        <div className={styles.adLandingCopy}>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1>{content.heading}</h1>
          <p className={styles.productDetailLead}>{content.description}</p>
          <p className={styles.productDetailPrice}>From {formatNzd(priceInclGstCents)} incl GST</p>
          <PurchaseTrustStrip />
          <div className={styles.designDetailActions}>
            <Link className={styles.primaryButton} href={configureHref}>Start Customising</Link>
            <AnalyticsLink
              className={styles.secondaryButton}
              href="https://m.me/RandRgallery"
              rel="noopener noreferrer"
              events={[
                { event: "messenger_click", location: content.path },
                { event: "generate_lead", method: "messenger" },
              ]}
            >Message on Messenger</AnalyticsLink>
          </div>
        </div>
        <div className={styles.adLandingHeroMedia}>
          <Image src={content.examples[0].src} alt={content.examples[0].alt} fill priority sizes="(max-width: 820px) 100vw, 48vw" />
        </div>
      </section>

      <section className={styles.adLandingSection}>
        <div><p className={styles.eyebrow}>Product details</p><h2>What is included</h2></div>
        <div><strong>{content.sizeSummary}</strong><ul>{content.included.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </section>
      <section className={styles.adLandingSection}>
        <div><p className={styles.eyebrow}>Simple process</p><h2>How it works</h2></div>
        <ol>
          <li><strong>Customise</strong><span>Choose the product options and add your wording.</span></li>
          <li><strong>Send photos</strong><span>Upload now or send them after ordering.</span></li>
          <li><strong>Approve the proof</strong><span>Review the design before printing.</span></li>
          <li><strong>Production and delivery</strong><span>Standard production is 5 business days, followed by delivery.</span></li>
        </ol>
      </section>
      <section className={styles.adLandingExamples}>
        <div><p className={styles.eyebrow}>R&amp;R product examples</p><h2>See the finished format</h2></div>
        <div>{content.examples.map((example) => <Image key={example.src} src={example.src} alt={example.alt} width={900} height={900} sizes="(max-width: 720px) 100vw, 46vw" />)}</div>
      </section>
      <section className={styles.adLandingFaq}>
        <p className={styles.eyebrow}>Questions</p><h2>Frequently asked questions</h2>
        {content.faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
      </section>
      <section className={styles.adLandingFinalCta}>
        <h2>Ready to create yours?</h2>
        <Link className={styles.primaryButton} href={configureHref}>Start Customising</Link>
      </section>
    </main>
  );
}
