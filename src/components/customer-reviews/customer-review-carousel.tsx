"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { PublicCustomerReview } from "@/domain/customer-reviews/types";
import { CustomerReviewCard } from "./customer-review-card";
import styles from "./customer-reviews.module.css";

export function CustomerReviewCarousel({ reviews }: Readonly<{
  reviews: readonly PublicCustomerReview[];
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const syncIndex = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = Array.from(container.children) as HTMLElement[];
    if (cards.length === 0) return;
    const closest = cards.reduce((best, card, cardIndex) => (
      Math.abs(card.offsetLeft - container.scrollLeft)
        < Math.abs(cards[best].offsetLeft - container.scrollLeft)
        ? cardIndex
        : best
    ), 0);
    setIndex(closest);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", syncIndex);
    return () => window.removeEventListener("resize", syncIndex);
  }, [syncIndex]);

  function move(target: number) {
    const next = Math.max(0, Math.min(target, reviews.length - 1));
    const container = containerRef.current;
    const card = container?.children.item(next) as HTMLElement | null;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    container?.scrollTo({ left: card?.offsetLeft ?? 0, behavior: reduceMotion ? "auto" : "smooth" });
    setIndex(next);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(index + 1);
    }
  }

  if (reviews.length === 0) return null;
  return <div className={styles.carouselArea}>
    <div className={styles.carouselControls}>
      <span aria-live="polite">{index + 1} / {reviews.length}</span>
      <button type="button" aria-label="Previous recommendations" disabled={index === 0} onClick={() => move(index - 1)}>←</button>
      <button type="button" aria-label="Next recommendations" disabled={index === reviews.length - 1} onClick={() => move(index + 1)}>→</button>
    </div>
    <div ref={containerRef} className={styles.carousel} role="region" aria-label="Customer recommendations" tabIndex={0} onKeyDown={keyDown} onScroll={syncIndex}>
      {reviews.map((review) => <CustomerReviewCard key={review.id} review={review} />)}
    </div>
  </div>;
}
