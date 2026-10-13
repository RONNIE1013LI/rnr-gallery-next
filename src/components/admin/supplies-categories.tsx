"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplyCategory } from "@/domain/supplies/types";
import { SUPPLIES_IMAGE_LIMITS } from "@/domain/supplies/image-limits";
import { supplyImageFileError, uploadSupplyImage } from "./supplies-images";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

export function SuppliesCategories({ categories, canPublish, canDeleteMedia = false }: Readonly<{ categories: readonly SupplyCategory[]; canPublish: boolean; canDeleteMedia?: boolean }>) {
  const router = useRouter();
  const [editing, setEditing] = useState<SupplyCategory | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => uploadRequest.current?.abort(), []);

  async function save(form: HTMLFormElement) {
    if (pending) return;
    setPending(true); setMessage("");
    const data = new FormData(form);
    try {
      const response = await fetch(editing ? `/api/admin/supplies/categories/${encodeURIComponent(editing.id)}` : "/api/admin/supplies/categories", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(data.get("name") ?? ""), slug: String(data.get("slug") ?? ""), description: String(data.get("description") ?? ""), sortOrder: Number(data.get("sortOrder") ?? 0), visible: canPublish ? data.get("visible") === "on" : editing?.visible ?? false, archived: data.get("archived") === "on" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Category could not be saved.");
      if (payload?.category?.id) setEditing(payload.category);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Category could not be saved."); }
    finally { setPending(false); }
  }

  async function uploadImage(file: File) {
    if (!editing || pending) return;
    const fileError = supplyImageFileError(file);
    if (fileError) { setMessage(fileError); return; }
    setPending(true); setMessage(""); setProgress(0);
    const request = new XMLHttpRequest(); uploadRequest.current = request;
    try {
      const image = await uploadSupplyImage(`/api/admin/supplies/categories/${encodeURIComponent(editing.id)}/image`, file, editing.name, setProgress, request);
      setEditing({ ...editing, image }); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Category image could not be uploaded."); }
    finally { setPending(false); setProgress(null); uploadRequest.current = null; }
  }

  async function removeImage() {
    if (!editing?.image || pending || !canDeleteMedia || !window.confirm("Remove the category image?")) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/supplies/categories/${encodeURIComponent(editing.id)}/image`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Category image could not be removed.");
      setEditing({ ...editing, image: null }); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Category image could not be removed."); }
    finally { setPending(false); }
  }

  async function archive(category: SupplyCategory) {
    if (pending || !window.confirm(`Archive ${category.name}? Its products will no longer be publicly available.`)) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/supplies/categories/${encodeURIComponent(category.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Category could not be archived.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Category could not be archived."); }
    finally { setPending(false); }
  }

  return <div className={suppliesStyles.stack}>
    {message ? <p role="alert" className={suppliesStyles.error}>{message}</p> : null}
    <form key={editing?.id ?? "new"} className={`${styles.formPanel} ${suppliesStyles.stack}`} onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
      <div className={suppliesStyles.sectionHeading}><div><h2>{editing ? `Edit ${editing.name}` : "New category"}</h2><p>Categories are managed here. Keep slugs stable once customers use their links.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Category name</span><input aria-label="Category name" name="name" defaultValue={editing?.name ?? ""} maxLength={160} required /></label>
        <label><span>Category slug</span><input aria-label="Category slug" name="slug" defaultValue={editing?.slug ?? ""} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={160} required /><small>Lowercase letters, numbers and hyphens.</small></label>
        <label className={styles.fullField}><span>Description</span><textarea aria-label="Category description" name="description" rows={3} defaultValue={editing?.description ?? ""} maxLength={4000} /></label>
        <label><span>Display order</span><input aria-label="Category display order" name="sortOrder" type="number" min={0} max={100000} step={1} defaultValue={editing?.sortOrder ?? 0} required /><small>Smaller numbers appear first.</small></label>
        <label className={styles.checkboxField}><input aria-label="Category visible" name="visible" type="checkbox" defaultChecked={editing?.visible ?? false} disabled={!canPublish} /><span>Visible in public store</span></label>
        {editing ? <label className={styles.checkboxField}><input aria-label="Category archived" name="archived" type="checkbox" defaultChecked={editing.archived} /><span>Archived</span></label> : null}
      </div>
      {!canPublish ? <p className={suppliesStyles.hint}>Changing public visibility requires Publish content permission.</p> : null}
      <div className={suppliesStyles.actions}><button type="submit" disabled={pending} className={styles.primaryAdminButton}>{pending ? "Saving…" : editing ? "Save category" : "Create category"}</button>{editing ? <button type="button" disabled={pending} className={styles.secondaryAdminButton} onClick={() => setEditing(null)}>New category</button> : null}</div>
    </form>
    {editing ? <section className={`${styles.formPanel} ${suppliesStyles.stack}`} aria-label="Category image">
      <div className={suppliesStyles.sectionHeading}><div><h2>Category image</h2><p>A saved category can have one image. Replacing it removes the old reference safely.</p></div></div>
      {editing.image ? <div className={suppliesStyles.thumbnail}><Image src={`/api/admin/supplies/images/${encodeURIComponent(editing.image.id)}`} alt={editing.image.altText} width={editing.image.width} height={editing.image.height} unoptimized /></div> : null}
      <div className={suppliesStyles.dropzone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && (!editing.image || canDeleteMedia)) void uploadImage(file); }}><label><span>Upload category image</span><input aria-label="Upload category image" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending || (!!editing.image && !canDeleteMedia)} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadImage(file); }} /></label><p className={suppliesStyles.hint}>JPEG, PNG or WebP up to {SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB. Each side 100–12,000 px, at most 40 megapixels. Content and dimensions are verified on the server.</p></div>
      {progress != null ? <><progress aria-label="Uploading category image" value={progress} max={100} /><span role="status">{progress === 100 ? "Processing image…" : `Uploading ${progress}%`}</span></> : null}
      {editing.image && canDeleteMedia ? <div><button type="button" className={styles.secondaryAdminButton} disabled={pending} onClick={() => void removeImage()}>Remove category image</button></div> : null}
      {editing.image && !canDeleteMedia ? <p className={suppliesStyles.hint}>Replacing or removing this image requires Delete media permission.</p> : null}
    </section> : <p className={suppliesStyles.hint}>Save a category before uploading its image.</p>}
    <div className={suppliesStyles.categoryCards}>{[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => <article className={suppliesStyles.categoryCard} key={category.id}>
      {category.image ? <Image src={`/api/admin/supplies/images/${encodeURIComponent(category.image.id)}`} alt={category.image.altText} width={category.image.width} height={category.image.height} unoptimized /> : null}<h3>{category.name}</h3><p>/{category.slug}</p><span className={styles.statusBadge}>{category.archived ? "Archived" : category.visible ? "Visible" : "Hidden"} · Order {category.sortOrder}</span>{category.description ? <p>{category.description}</p> : null}
      <div className={suppliesStyles.actions}><button type="button" className={styles.secondaryAdminButton} disabled={pending} aria-label={`Edit ${category.name}`} onClick={() => { setEditing(category); setMessage(""); }}>Edit</button>{!category.archived ? <button type="button" disabled={pending} className={styles.secondaryAdminButton} onClick={() => void archive(category)} aria-label={`Archive ${category.name}`}>Archive</button> : null}</div>
    </article>)}</div>
    {!categories.length ? <p className={styles.mutedText}>No categories yet. Create a category before adding products.</p> : null}
  </div>;
}
