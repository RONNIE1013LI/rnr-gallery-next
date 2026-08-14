import Link from "next/link";
import reviewData from "@/content/facebook-reviews.json";
import styles from "./storefront.module.css";

type FacebookReviewsProps = Readonly<{
  compact?: boolean;
  page?: number;
  pagePath: string;
}>;

export function FacebookReviews({
  compact = false,
  page = 1,
  pagePath,
}: FacebookReviewsProps) {
  const pageSize = compact ? 2 : 3;
  const pageCount = Math.ceil(reviewData.reviews.length / pageSize);
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const reviews = reviewData.reviews.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function reviewPageHref(targetPage: number) {
    const separator = pagePath.includes("?") ? "&" : "?";
    return `${pagePath}${separator}reviews=${targetPage}#facebook-recommendations`;
  }

  if (!reviews.length) return null;

  return (
    <section
      aria-label="Facebook recommendations"
      className={`${styles.facebookReviews} ${compact ? styles.facebookReviewsCompact : ""}`}
      id="facebook-recommendations"
    >
      <div className={styles.facebookReviewsHeader}>
        <div>
          <h2>Recommended by our customers.</h2>
        </div>
        <div className={styles.facebookReviewsActions}>
          <p className={styles.facebookRecommendationStat}>
            <strong>{reviewData.recommendationRate}% Recommended</strong>
            <span>{reviewData.reviewCount} Facebook reviews</span>
          </p>
          <a href={reviewData.sourceUrl} rel="noreferrer" target="_blank">
            View Facebook recommendations
          </a>
        </div>
      </div>
      <ul className={styles.facebookReviewGrid}>
        {reviews.map((review) => (
          <li className={styles.facebookReviewCard} key={review.id}>
            <p className={styles.facebookReviewSource}>Recommended on Facebook</p>
            <blockquote>“{review.text}”</blockquote>
            <p className={styles.facebookReviewAuthor}>{review.reviewer}</p>
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <nav aria-label="Review pages" className={styles.facebookReviewPager}>
          <Link
            aria-label="Previous recommendations"
            aria-disabled={currentPage === 1}
            className={currentPage === 1 ? styles.facebookReviewPagerDisabled : ""}
            href={reviewPageHref(Math.max(1, currentPage - 1))}
          >
            ←
          </Link>
          <span aria-live="polite">
            {currentPage} / {pageCount}
          </span>
          <Link
            aria-label="Next recommendations"
            aria-disabled={currentPage === pageCount}
            className={
              currentPage === pageCount ? styles.facebookReviewPagerDisabled : ""
            }
            href={reviewPageHref(Math.min(pageCount, currentPage + 1))}
          >
            →
          </Link>
        </nav>
      )}
    </section>
  );
}
