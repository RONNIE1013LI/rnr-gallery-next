"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./storefront.module.css";

export type AdminGalleryListItem = Readonly<{
  id: string;
  altText: string;
  imageUrl: string;
  productTypeSlug: string;
  occasionSlug: string;
  subOccasion: string | null;
  productSlug: string;
  status: "active" | "trashed";
}>;

function label(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function AdminGalleryThumbnail({ design }: Readonly<{ design: AdminGalleryListItem }>) {
  const [failed, setFailed] = useState(false);
  if (design.status === "trashed" || failed) {
    return (
      <div className={styles.adminGalleryArtworkUnavailable} role="img" aria-label={`${design.altText} preview unavailable`}>
        {design.status === "trashed" ? "Trashed" : "Preview unavailable"}
      </div>
    );
  }
  return <Image src={design.imageUrl} alt="" width={88} height={88} unoptimized onError={() => setFailed(true)} />;
}

export function AdminGalleryList({ designs }: Readonly<{ designs: readonly AdminGalleryListItem[] }>) {
  const pageSize = 24;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "trashed">("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return designs.filter((design) => {
      if (status !== "all" && design.status !== status) return false;
      return !needle || [design.altText, design.productTypeSlug, design.occasionSlug, design.subOccasion, design.productSlug, design.id]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [designs, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleDesigns = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (designs.length === 0) {
    return <p className={styles.adminEmpty}>No gallery designs found.</p>;
  }

  return (<>
    <details className={styles.adminGalleryFilterDisclosure}>
      <summary><span>Search and filters</span><span>{filtered.length} shown</span></summary>
      <div className={styles.adminGalleryFilters}>
        <label><span>Search designs</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Title, occasion, product or ID" /></label>
        <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="trashed">Trashed</option></select></label>
        <span>{filtered.length} shown</span>
      </div>
    </details>
    {filtered.length ? <div className={styles.adminGalleryTable}>
      <div className={styles.adminGalleryTableHeader} aria-hidden="true">
        <span>Artwork</span>
        <span>Classification</span>
        <span>Target product</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {visibleDesigns.map((design) => (
        <article className={styles.adminGalleryRow} key={design.id}>
          <div className={styles.adminGalleryArtwork}>
            <AdminGalleryThumbnail design={design} />
            <div>
              <h2>{design.altText}</h2>
              <small>{design.id.slice(0, 10)}</small>
            </div>
          </div>
          <div className={styles.adminGalleryMeta}>
            <strong>{label(design.productTypeSlug)}</strong>
            <span>{label(design.occasionSlug)}</span>
            {design.subOccasion ? <span>{design.subOccasion}</span> : null}
          </div>
          <span className={styles.adminGalleryProduct}>{label(design.productSlug)}</span>
          <div className={styles.adminGalleryFooter}>
            <span className={design.status === "active" ? styles.adminStatusActive : styles.adminStatusTrashed}>
              {label(design.status)}
            </span>
            <div className={styles.adminGalleryActions}>
              {design.status === "active" ? (
                <Link href={`/design-gallery?design=${design.id}`}>Preview</Link>
              ) : null}
              <Link href={`/admin/design-gallery/${design.id}`} aria-label={`Edit ${design.altText}`}>Edit</Link>
            </div>
          </div>
        </article>
      ))}
    </div> : <p className={styles.adminEmpty}>No gallery designs match this search.</p>}
    {filtered.length > pageSize ? (
      <nav className={styles.adminGalleryPagination} aria-label="Gallery pages">
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Previous gallery page">Previous</button>
        <span>Page {currentPage} of {pageCount}</span>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} aria-label="Next gallery page">Next</button>
      </nav>
    ) : null}
  </>);
}
