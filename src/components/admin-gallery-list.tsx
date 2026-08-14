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

export function AdminGalleryList({ designs }: Readonly<{ designs: readonly AdminGalleryListItem[] }>) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "trashed">("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return designs.filter((design) => {
      if (status !== "all" && design.status !== status) return false;
      return !needle || [design.altText, design.productTypeSlug, design.occasionSlug, design.subOccasion, design.productSlug, design.id]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [designs, query, status]);

  if (designs.length === 0) {
    return <p className={styles.adminEmpty}>No gallery designs found.</p>;
  }

  return (<>
    <div className={styles.adminGalleryFilters}>
      <label><span>Search designs</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, occasion, product or ID" /></label>
      <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="active">Active</option><option value="trashed">Trashed</option></select></label>
      <span>{filtered.length} shown</span>
    </div>
    {filtered.length ? <div className={styles.adminGalleryTable}>
      <div className={styles.adminGalleryTableHeader} aria-hidden="true">
        <span>Artwork</span>
        <span>Classification</span>
        <span>Target product</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {filtered.map((design) => (
        <article className={styles.adminGalleryRow} key={design.id}>
          <div className={styles.adminGalleryArtwork}>
            <Image src={design.imageUrl} alt="" width={88} height={88} unoptimized />
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
          <span className={design.status === "active" ? styles.adminStatusActive : styles.adminStatusTrashed}>
            {label(design.status)}
          </span>
          <div className={styles.adminGalleryActions}>
            {design.status === "active" ? (
              <Link href={`/design-gallery?design=${design.id}`}>Preview</Link>
            ) : null}
            <Link href={`/admin/design-gallery/${design.id}`} aria-label={`Edit ${design.altText}`}>Edit</Link>
          </div>
        </article>
      ))}
    </div> : <p className={styles.adminEmpty}>No gallery designs match this search.</p>}
  </>);
}
