"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";

import type {
  AdminCustomerReview,
  CustomerReviewSourcePlatform,
} from "@/domain/customer-reviews/types";
import styles from "./admin.module.css";

export type CustomerReviewProductOption = Readonly<{ key: string; title: string }>;

function toLocalDateTime(value: string | null) {
  return value ? value.slice(0, 16) : "";
}

function ReviewMediaField({ name, label, hint, current }: Readonly<{
  name: "avatar" | "featuredImage";
  label: string;
  hint: string;
  current?: string;
}>) {
  const [preview, setPreview] = useState<string | null>(current ?? null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);
  function change(event: ChangeEvent<HTMLInputElement>) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = event.currentTarget.files?.[0];
    const next = file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
    setObjectUrl(next);
    setPreview(next ?? current ?? null);
  }
  return <label><span>{label}</span>{preview ? <Image src={preview} alt={`Preview: ${label}`} width={180} height={120} unoptimized /> : null}<input name={name} type="file" accept="image/jpeg,image/png,image/webp" onChange={change} /><small>{hint}</small></label>;
}

export function CustomerReviewForm({ review, products, canPublish }: Readonly<{
  review?: AdminCustomerReview;
  products: readonly CustomerReviewProductOption[];
  canPublish: boolean;
}>) {
  const router = useRouter();
  const [permissionStatus, setPermissionStatus] = useState(review?.permissionStatus ?? "PENDING");
  const [recommendationStatus, setRecommendationStatus] = useState(review?.recommendationStatus ?? "RECOMMENDS");
  const [sourcePlatform, setSourcePlatform] = useState<CustomerReviewSourcePlatform>(review?.sourcePlatform ?? "FACEBOOK");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewerName, setReviewerName] = useState(review?.reviewerName ?? "");
  const [reviewText, setReviewText] = useState(review?.originalReviewText ?? "");
  const [editorialHeadline, setEditorialHeadline] = useState(review?.editorialHeadline ?? "");
  const canPublishThisReview = canPublish && permissionStatus === "GRANTED" && recommendationStatus === "RECOMMENDS";
  const published = review?.status === "PUBLISHED";

  async function submit(formElement: HTMLFormElement, action: "save_draft" | "publish") {
    if (pending) return;
    setPending(true);
    setMessage("");
    const form = new FormData(formElement);
    form.set("action", action);
    const productKey = String(form.get("productKey") ?? "");
    form.set("productDisplayLabel", products.find((product) => product.key === productKey)?.title ?? "");
    const lastVerifiedAt = String(form.get("lastVerifiedAt") ?? "");
    if (lastVerifiedAt) form.set("lastVerifiedAt", new Date(lastVerifiedAt).toISOString());
    try {
      const response = await fetch(
        review ? `/api/admin/customer-reviews/${review.id}` : "/api/admin/customer-reviews",
        { method: review ? "PUT" : "POST", body: form },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Customer review could not be saved.");
      router.push("/admin/customer-reviews");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer review could not be saved.");
      setPending(false);
    }
  }

  async function archive() {
    if (!review || pending || !window.confirm("Archive this customer review? It will be removed from every public page.")) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/customer-reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Customer review could not be archived.");
      router.push("/admin/customer-reviews");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer review could not be archived.");
      setPending(false);
    }
  }

  return <form className={styles.reviewEditor} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget, published ? "publish" : "save_draft"); }}>
    {!canPublish ? <p className={styles.safetyBanner}>You can save drafts. Publishing requires the independent Publish reviews permission.</p> : null}
    {review ? <dl className={styles.formRecordSummary}><div><dt>Status</dt><dd>{review.status}</dd></div><div><dt>Created</dt><dd>{review.createdAt.toLocaleDateString("en-NZ")}</dd></div><div><dt>Updated</dt><dd>{review.updatedAt.toLocaleDateString("en-NZ")}</dd></div><div><dt>Source</dt><dd>{sourcePlatform === "GOOGLE" ? "Google" : "Facebook"}</dd></div></dl> : null}

    <section className={styles.formPanel}>
      <div className={styles.formSectionHeading}><div><span>1</span><h2>Original review</h2></div><p>Keep the customer’s wording exactly as posted. Editorial context is stored separately.</p></div>
      <div className={styles.formGrid}>
        <label><span>Source</span><select aria-label="Source" name="sourcePlatform" value={sourcePlatform} onChange={(event) => setSourcePlatform(event.target.value as CustomerReviewSourcePlatform)}><option value="FACEBOOK">Facebook</option><option value="GOOGLE">Google</option></select></label>
        <label><span>Reviewer name</span><input aria-label="Reviewer name" name="reviewerName" value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} maxLength={120} required /></label>
        <label><span>Review date</span><input aria-label="Review date" name="reviewDate" defaultValue={review?.reviewDate ?? ""} type="date" required /></label>
        <label className={styles.fullField}><span>Original review</span><textarea aria-label="Original review" name="originalReviewText" value={reviewText} onChange={(event) => setReviewText(event.target.value)} rows={8} maxLength={10_000} required /></label>
        <label className={styles.fullField}><span>Source review URL (optional)</span><input name="sourceReviewUrl" defaultValue={review?.sourceReviewUrl ?? ""} type="url" placeholder={sourcePlatform === "GOOGLE" ? "https://g.page/..." : "https://www.facebook.com/..."} /></label>
        <label><span>Recommendation status</span><select aria-label="Recommendation status" name="recommendationStatus" value={recommendationStatus} onChange={(event) => setRecommendationStatus(event.target.value as typeof recommendationStatus)}><option value="RECOMMENDS">Recommends</option><option value="DOES_NOT_RECOMMEND">Does not recommend</option><option value="LEGACY_STAR_REVIEW">Legacy star review</option></select></label>
        <label><span>Last verified (optional)</span><input name="lastVerifiedAt" defaultValue={toLocalDateTime(review?.lastVerifiedAt ?? null)} type="datetime-local" /></label>
      </div>
    </section>

    <section className={styles.formPanel}>
      <div className={styles.formSectionHeading}><div><span>2</span><h2>Public presentation</h2></div><p>Optional context supports the storefront card without changing the original review.</p></div>
      <div className={styles.formGrid}>
        <label className={styles.fullField}><span>R&amp;R Gallery editorial heading (optional)</span><input name="editorialHeadline" value={editorialHeadline} onChange={(event) => setEditorialHeadline(event.target.value)} maxLength={240} /></label>
        <label><span>Associated product (optional)</span><select name="productKey" defaultValue={review?.productKey ?? ""}><option value="">General customer story</option>{products.map((product) => <option key={product.key} value={product.key}>{product.title}</option>)}</select></label>
        <label><span>Order context (optional)</span><input name="orderContext" defaultValue={review?.orderContext ?? ""} maxLength={500} /></label>
        <label><span>Display order</span><input name="displayOrder" defaultValue={review?.displayOrder ?? 0} min="0" max="1000000" step="1" type="number" required /></label>
        <label className={styles.checkboxField}><input name="isHomepageFeatured" type="checkbox" defaultChecked={review?.isHomepageFeatured ?? false} disabled={permissionStatus !== "GRANTED" || recommendationStatus !== "RECOMMENDS"} /><span>Use as the Homepage featured story</span></label>
      </div>
    </section>

    <section className={styles.reviewPublicPreview} aria-label="Public review card preview"><p>PUBLIC CARD PREVIEW</p>{editorialHeadline ? <><small>R&amp;R Gallery editorial heading</small><h2>{editorialHeadline}</h2></> : null}<strong>{reviewerName || "Reviewer name"}</strong><blockquote>{reviewText || "The original review will appear here exactly as entered."}</blockquote><span>recommends R&amp;R Gallery</span></section>

    <section className={styles.formPanel}>
      <div className={styles.formSectionHeading}><div><span>3</span><h2>Images</h2></div><p>Review images are permanent business media and are excluded from the five-day checkout upload cleanup.</p></div>
      <div className={styles.reviewMediaGrid}>
        <ReviewMediaField name="avatar" label="Reviewer avatar (optional)" current={review?.media.find((media) => media.kind === "AVATAR")?.adminUrl} hint="JPG, PNG or WebP. Maximum 25 MB." />
        <ReviewMediaField name="featuredImage" label="Featured customer image (optional)" current={review?.media.find((media) => media.kind === "FEATURED_IMAGE")?.adminUrl} hint="Only publish images with customer marketing permission." />
      </div>
    </section>

    <section className={styles.formPanel}>
      <div className={styles.formSectionHeading}><div><span>4</span><h2>Permission record</h2></div><p>Private operational evidence. These fields and files are never included in the public DTO.</p></div>
      <div className={styles.formGrid}>
        <label><span>Permission status</span><select aria-label="Permission status" name="permissionStatus" value={permissionStatus} onChange={(event) => setPermissionStatus(event.target.value as typeof permissionStatus)}><option value="PENDING">Pending</option><option value="GRANTED">Granted</option><option value="REVOKED">Revoked</option></select></label>
        <label><span>Evidence reference (optional)</span><input name="permissionEvidenceReference" defaultValue={review?.permissionEvidenceReference ?? ""} maxLength={500} /></label>
        <label className={styles.fullField}><span>Permission notes (optional)</span><textarea name="permissionNotes" defaultValue={review?.permissionNotes ?? ""} rows={4} maxLength={2_000} /></label>
        <label className={styles.fullField}><span>Permission evidence image (optional)</span>{review?.media.some((media) => media.kind === "PERMISSION_EVIDENCE") ? <small>Existing private evidence is stored. Upload a file only to replace it.</small> : null}<input name="permissionEvidence" type="file" accept="image/jpeg,image/png,image/webp" /></label>
      </div>
    </section>

    <div className={styles.reviewFormActions}>
      {!published ? <button type="submit" disabled={pending}>Save draft</button> : null}
      {canPublish ? <button type="button" disabled={pending || !canPublishThisReview} onClick={(event) => void submit(event.currentTarget.form!, "publish")}>{published ? "Save published review" : "Publish review"}</button> : null}
      <Link className={styles.secondaryAdminButton} href="/admin/customer-reviews">Cancel</Link>
      {review && review.status !== "ARCHIVED" ? <button className={styles.reviewArchiveButton} type="button" disabled={pending} onClick={() => void archive()}>Archive review</button> : null}
      <span role="status">{message}</span>
    </div>
    {canPublish && !canPublishThisReview ? <p className={styles.reviewPublishRequirement}>{permissionStatus !== "GRANTED" ? "Permission must be granted before publishing." : "Only a positive customer review can be published."}</p> : null}
  </form>;
}
