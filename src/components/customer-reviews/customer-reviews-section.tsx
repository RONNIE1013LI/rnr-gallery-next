import Image from "next/image";
import { FaStar } from "react-icons/fa";

import type { PublicCustomerReviewSection } from "@/domain/customer-reviews/types";
import { CustomerReviewCard } from "./customer-review-card";
import { CustomerReviewCarousel } from "./customer-review-carousel";
import styles from "./customer-reviews.module.css";

export function CustomerReviewsSection({ data }: Readonly<{
  data: PublicCustomerReviewSection;
}>) {
  const { featured, summary } = data;
  return <section className={styles.section} aria-label="Customer reviews">
    <div className={styles.shell}>
      <header className={styles.sectionHeader}>
        <div><p className={styles.eyebrow}>REAL CUSTOMER REVIEWS</p><h2 id="customer-reviews-title">Recommended by our customers.</h2><p>Selected public recommendations originally shared on our Facebook Page.</p></div>
        {summary ? <div className={styles.facebookSummary}>
          <strong className={styles.facebookSummaryLabel}>EXCELLENT</strong>
          <span className={styles.facebookSummaryStars} aria-label={`${summary.rating} out of 5`}>
            {Array.from({ length: 5 }, (_, index) => <FaStar key={index} aria-hidden="true" />)}
          </span>
          <p className={styles.facebookSummaryCount}>Based on {summary.recommendationCount}{summary.countIsApproximate ? "+" : ""} recommendations</p>
          <span className={styles.facebookWord}>facebook</span>
          <a href={summary.reviewsPageUrl} target="_blank" rel="noopener noreferrer">View all on Facebook</a>
        </div> : null}
      </header>
      <div className={`${styles.featuredLayout} ${featured.featuredImage ? "" : styles.featuredWithoutImage}`}>
        {featured.featuredImage ? <div className={styles.featuredImage}><Image src={featured.featuredImage.url} alt={featured.productDisplayLabel ? `${featured.productDisplayLabel} shared with this customer recommendation` : "Customer image shared with this recommendation"} fill sizes="(max-width: 760px) calc(100vw - 40px), 42vw" unoptimized /></div> : null}
        <CustomerReviewCard review={featured} featured />
      </div>
      {data.reviews.length ? <CustomerReviewCarousel reviews={data.reviews} /> : null}
    </div>
  </section>;
}
