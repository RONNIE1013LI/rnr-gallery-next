"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { FaFacebookF, FaHeart } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";

import type { PublicCustomerReview } from "@/domain/customer-reviews/types";
import { formatRelativeReviewDate } from "@/domain/customer-reviews/relative-date";
import { useContainedDialog } from "@/components/forms/use-contained-dialog";
import styles from "./customer-reviews.module.css";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function CustomerReviewCard({ review, featured = false }: Readonly<{
  review: PublicCustomerReview;
  featured?: boolean;
}>) {
  const date = formatRelativeReviewDate(review.reviewDate);
  const [overflows, setOverflows] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const isGoogle = review.sourcePlatform === "GOOGLE";
  const sourceLabel = isGoogle ? "Google" : "Facebook";
  const sourceIcon = isGoogle
    ? <FcGoogle className={styles.sourceIcon} aria-label="Google" />
    : <FaFacebookF className={`${styles.sourceIcon} ${styles.facebookIcon}`} aria-label="Facebook" />;

  useEffect(() => {
    if (featured) return;
    const text = textRef.current;
    if (!text) return;
    const measure = () => setOverflows(text.scrollHeight > text.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(text);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [featured, review.originalReviewText]);

  useContainedDialog({
    active: dialogOpen,
    dialogRef,
    initialFocusRef: closeRef,
    isolationRootRef: cardRef,
    returnFocusRef: triggerRef,
    onClose: () => setDialogOpen(false),
  });

  return <article ref={cardRef} className={`${styles.reviewCard} ${featured ? styles.featuredCard : ""}`} aria-label={`${featured ? "Featured recommendation" : "Recommendation"} from ${review.reviewerName}`}>
    <header className={styles.reviewerHeader}>
      {review.avatar ? <Image className={styles.avatar} src={review.avatar.url} alt="" width={review.avatar.width} height={review.avatar.height} sizes="48px" unoptimized /> : <span className={styles.initials} aria-hidden="true">{initials(review.reviewerName)}</span>}
      <div><strong>{review.reviewerName}</strong><time dateTime={date.dateTime} title={date.title}>{date.label}</time></div>
      {sourceIcon}
    </header>
    <p className={styles.recommendationLine}><FaHeart aria-hidden="true" /> recommends R&amp;R Gallery</p>
    {featured && review.editorialHeadline ? <p className={styles.editorialLabel}>Customer story</p> : null}
    {featured && review.editorialHeadline ? <h3>{review.editorialHeadline}</h3> : null}
    <p ref={textRef} className={`${styles.reviewText} ${featured ? "" : styles.clampedText}`}>{review.originalReviewText}</p>
    {featured && review.orderContext ? <p className={styles.orderContext}>{review.orderContext}</p> : null}
    <div className={styles.cardActions}>
      {!featured && overflows ? <button ref={triggerRef} type="button" onClick={() => setDialogOpen(true)} aria-label={`Read full recommendation from ${review.reviewerName}`}>Read full recommendation</button> : null}
      {review.sourceReviewUrl ? <a href={review.sourceReviewUrl} target="_blank" rel="noopener noreferrer">View original on {sourceLabel}</a> : null}
    </div>
    {dialogOpen ? <div className={styles.dialogBackdrop}>
      <div ref={dialogRef} className={styles.reviewDialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button ref={closeRef} className={styles.dialogClose} type="button" onClick={() => setDialogOpen(false)} aria-label="Close full recommendation">×</button>
        <p className={styles.dialogSource}>{isGoogle ? <FcGoogle aria-hidden="true" /> : <FaFacebookF aria-hidden="true" />} {sourceLabel} review</p>
        <h2 id={titleId}>Recommendation from {review.reviewerName}</h2>
        <time dateTime={date.dateTime} title={date.title}>{date.label} · {date.title}</time>
        <p className={styles.dialogText}>{review.originalReviewText}</p>
        {review.sourceReviewUrl ? <a href={review.sourceReviewUrl} target="_blank" rel="noopener noreferrer">View original on {sourceLabel}</a> : null}
      </div>
    </div> : null}
  </article>;
}
