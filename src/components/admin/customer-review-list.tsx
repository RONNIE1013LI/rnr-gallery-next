"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";

import type {
  AdminCustomerReview,
  CustomerReviewPermissionStatus,
  CustomerReviewStatus,
} from "@/domain/customer-reviews/types";
import styles from "./admin.module.css";

function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function CustomerReviewList({ reviews }: Readonly<{
  reviews: readonly AdminCustomerReview[];
}>) {
  const [status, setStatus] = useState<CustomerReviewStatus | "ALL">("ALL");
  const [permission, setPermission] = useState<CustomerReviewPermissionStatus | "ALL">("ALL");
  const [featured, setFeatured] = useState<"ALL" | "FEATURED">("ALL");
  const [archivedIds, setArchivedIds] = useState<readonly string[]>([]);
  const visible = useMemo(() => reviews.filter((review) =>
    !archivedIds.includes(review.id) &&
    (status === "ALL" || review.status === status) &&
    (permission === "ALL" || review.permissionStatus === permission) &&
    (featured === "ALL" || review.isHomepageFeatured)
  ), [archivedIds, featured, permission, reviews, status]);
  const [message, setMessage] = useState("");

  async function archive(review: AdminCustomerReview) {
    if (!window.confirm(`Archive the review from ${review.reviewerName}?`)) return;
    setMessage("");
    const response = await fetch(`/api/admin/customer-reviews/${review.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(payload?.error || "The review could not be archived.");
      return;
    }
    setArchivedIds((current) => [...current, review.id]);
  }

  if (reviews.length === 0) {
    return <div className={styles.emptyState}>
      <h2>No customer reviews yet</h2>
      <p>Add an approved Facebook recommendation when you are ready.</p>
      <Link href="/admin/customer-reviews/new">Add the first review</Link>
    </div>;
  }

  return <>
    <div className={styles.reviewFilters} aria-label="Review filters">
      <label><span>Status</span><select aria-label="Review status" value={status} onChange={(event) => setStatus(event.target.value as CustomerReviewStatus | "ALL")}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
      <label><span>Permission</span><select aria-label="Permission status filter" value={permission} onChange={(event) => setPermission(event.target.value as CustomerReviewPermissionStatus | "ALL")}><option value="ALL">All permissions</option><option value="PENDING">Pending</option><option value="GRANTED">Granted</option><option value="REVOKED">Revoked</option></select></label>
      <label><span>Homepage</span><select aria-label="Homepage feature filter" value={featured} onChange={(event) => setFeatured(event.target.value as "ALL" | "FEATURED")}><option value="ALL">All reviews</option><option value="FEATURED">Featured only</option></select></label>
    </div>
    {message ? <p className={styles.filterError} role="alert">{message}</p> : null}
    {visible.length ? <div className={styles.tableScroll}>
      <table className={`${styles.dataTable} ${styles.reviewTable}`}>
        <thead><tr><th>Reviewer</th><th>Source</th><th>Recommendation</th><th>Review date</th><th>Status</th><th>Permission</th><th>Featured / order</th><th>Product</th><th>Last verified</th><th>Actions</th></tr></thead>
        <tbody>{visible.map((review) => <tr key={review.id}>
          <td><div className={styles.reviewListIdentity}>{review.media.find((media) => media.kind === "AVATAR") ? <Image src={review.media.find((media) => media.kind === "AVATAR")!.adminUrl} alt="" width={36} height={36} unoptimized /> : <span aria-hidden="true">{initials(review.reviewerName)}</span>}<div><strong>{review.reviewerName}</strong><small className={styles.reviewExcerpt}>{review.originalReviewText}</small></div></div></td>
          <td>Facebook</td>
          <td>{titleCase(review.recommendationStatus)}</td>
          <td>{review.reviewDate}</td>
          <td><span className={styles.statusBadge}>{titleCase(review.status)}</span></td>
          <td><span className={styles.statusBadge}>{titleCase(review.permissionStatus)}</span></td>
          <td>{review.isHomepageFeatured ? "Homepage featured" : `Order ${review.displayOrder}`}</td>
          <td>{review.productDisplayLabel ?? "General"}</td>
          <td>{review.lastVerifiedAt ? new Date(review.lastVerifiedAt).toLocaleDateString("en-NZ") : "—"}</td>
          <td><div className={styles.reviewListActions}><Link className={styles.tableAction} href={`/admin/customer-reviews/${review.id}`} aria-label={`Edit ${review.reviewerName}`}>Edit</Link>{review.status !== "ARCHIVED" ? <button type="button" onClick={() => void archive(review)} aria-label={`Archive ${review.reviewerName}`}>Archive</button> : null}</div></td>
        </tr>)}</tbody>
      </table>
    </div> : <p className={styles.mutedText}>No reviews match these filters.</p>}
  </>;
}
