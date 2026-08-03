"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { galleryOccasions, galleryProductTypes, galleryThemes } from "@/domain/gallery/taxonomy";
import type { GalleryProductTypeSlug } from "@/domain/gallery/types";
import styles from "./storefront.module.css";

export type AdminGalleryFormDesign = Readonly<{
  id: string;
  altText: string;
  imageUrl: string;
  productTypeSlug: GalleryProductTypeSlug;
  occasionSlug: string;
  subOccasion: string | null;
  themeSlugs: readonly string[];
  productSlug: string;
  status: "active" | "trashed";
}>;

function label(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function AdminGalleryForm({ design }: Readonly<{ design?: AdminGalleryFormDesign }>) {
  const router = useRouter();
  const [productType, setProductType] = useState<GalleryProductTypeSlug>(design?.productTypeSlug ?? "canvas");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const productOptions = galleryProductTypes[productType];
  const initialProduct = productOptions.includes(design?.productSlug as never)
    ? design?.productSlug
    : productOptions[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        design ? `/api/admin/design-gallery/${design.id}` : "/api/admin/design-gallery",
        { method: design ? "PUT" : "POST", body: new FormData(event.currentTarget) },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "The design could not be saved.");
      }
      router.push("/admin/design-gallery");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The design could not be saved.");
      setSubmitting(false);
    }
  }

  async function changeStatus() {
    if (!design) return;
    setSubmitting(true);
    setError("");
    const restoring = design.status === "trashed";
    try {
      const response = await fetch(
        restoring
          ? `/api/admin/design-gallery/${design.id}/restore`
          : `/api/admin/design-gallery/${design.id}`,
        { method: restoring ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "The design status could not be changed.");
      }
      router.push("/admin/design-gallery");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The design status could not be changed.");
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.adminGalleryForm} onSubmit={submit}>
      {error ? <p className={styles.adminFormError} role="alert">{error}</p> : null}

      {design ? (
        <div className={styles.adminCurrentImage}>
          <Image src={design.imageUrl} alt={design.altText} width={360} height={360} unoptimized />
          <p>Current gallery image</p>
        </div>
      ) : null}

      <div className={styles.adminFormGrid}>
        <label className={styles.formField}>
          <span>Product type</span>
          <select
            name="productTypeSlug"
            value={productType}
            onChange={(event) => setProductType(event.target.value as GalleryProductTypeSlug)}
          >
            {Object.keys(galleryProductTypes).map((value) => <option value={value} key={value}>{label(value)}</option>)}
          </select>
        </label>

        <label className={styles.formField}>
          <span>Target product</span>
          <select name="productSlug" key={`${productType}-${initialProduct}`} defaultValue={initialProduct}>
            {productOptions.map((value) => <option value={value} key={value}>{label(value)}</option>)}
          </select>
        </label>

        <label className={styles.formField}>
          <span>Occasion</span>
          <select name="occasionSlug" defaultValue={design?.occasionSlug ?? "memorial"}>
            {galleryOccasions.map((value) => <option value={value} key={value}>{label(value)}</option>)}
          </select>
        </label>

        <label className={styles.formField}>
          <span>Sub-occasion</span>
          <input name="subOccasion" defaultValue={design?.subOccasion ?? ""} />
        </label>

        <label className={`${styles.formField} ${styles.adminFullField}`}>
          <span>Alt text</span>
          <input name="altText" defaultValue={design?.altText ?? ""} required />
        </label>

        <label className={`${styles.formField} ${styles.adminFullField}`}>
          <span>Image</span>
          <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
          {design ? <small>Leave empty to keep the current image.</small> : null}
        </label>
      </div>

      <fieldset className={styles.adminThemeFieldset}>
        <legend>Themes</legend>
        <div>
          {galleryThemes.map((theme) => (
            <label key={theme}>
              <input name="themeSlugs" type="checkbox" value={theme} defaultChecked={design?.themeSlugs.includes(theme)} />
              <span>{label(theme)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.adminFormActions}>
        <button className={styles.primaryButton} type="submit" disabled={submitting}>
          {submitting ? "Saving…" : design ? "Save changes" : "Add design"}
        </button>
        <Link className={styles.secondaryButton} href="/admin/design-gallery">Cancel</Link>
        {design ? (
          <button className={styles.adminStatusButton} type="button" disabled={submitting} onClick={changeStatus}>
            {design.status === "active" ? "Move to trash" : "Restore design"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
