"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { SupplyImage } from "@/domain/supplies/types";
import { SUPPLIES_IMAGE_LIMITS } from "@/domain/supplies/image-limits";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

type UploadState = { key: string; name: string; progress: number; status: "uploading" | "saved" | "error"; error?: string };

export function supplyImageFileError(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size) return "Choose a non-empty JPEG, PNG or WebP image.";
  if (file.size > SUPPLIES_IMAGE_LIMITS.maximumBytes) return `Each image must be ${SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB or smaller.`;
  return null;
}

export function uploadSupplyImage(endpoint: string, file: File, altText: string, progress: (percent: number) => void, request: XMLHttpRequest) {
  return new Promise<SupplyImage>((resolve, reject) => {
    const form = new FormData(); form.set("image", file); form.set("altText", altText);
    request.open("POST", endpoint); request.responseType = "json"; request.timeout = 120000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded * 100 / event.total)); };
    request.onload = () => {
      const payload = request.response;
      if (request.status < 200 || request.status >= 300 || !payload?.image?.id) { reject(new Error(payload?.error || "Image could not be uploaded.")); return; }
      resolve(payload.image as SupplyImage);
    };
    request.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
    request.ontimeout = () => reject(new Error("Upload timed out. Try again."));
    request.onabort = () => reject(new Error("Upload cancelled."));
    request.send(form);
  });
}

export function SuppliesImages({ productId, images: initialImages, canDelete }: Readonly<{ productId: string; images: readonly SupplyImage[]; canDelete: boolean }>) {
  const [images, setImages] = useState(() => [...initialImages].sort((a, b) => a.sortOrder - b.sortOrder));
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dragImage = useRef<string | null>(null);
  const requests = useRef(new Set<XMLHttpRequest>());
  const endpoint = `/api/admin/supplies/products/${encodeURIComponent(productId)}/images`;
  useEffect(() => { const active = requests.current; return () => { for (const request of active) request.abort(); }; }, []);

  async function persist(nextImages: readonly SupplyImage[]) {
    const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: nextImages.map((image, sortOrder) => ({ id: image.id, altText: image.altText, isCover: image.isCover, sortOrder })) }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "Image details could not be saved.");
  }

  async function upload(files: readonly File[], replaceId?: string) {
    if (pending || !files.length) return;
    setPending(true); setMessage(""); setSaved(false);
    let current = [...images];
    try {
      for (const file of files) {
        const key = createClientId();
        const fileError = supplyImageFileError(file);
        if (fileError) {
          setUploads((entries) => [...entries, { key, name: file.name, progress: 0, status: "error", error: fileError }]);
          continue;
        }
        setUploads((entries) => [...entries, { key, name: file.name, progress: 0, status: "uploading" }]);
        const request = new XMLHttpRequest(); requests.current.add(request);
        try {
          const image = await uploadSupplyImage(endpoint, file, "", (progress) => setUploads((entries) => entries.map((entry) => entry.key === key ? { ...entry, progress } : entry)), request);
          const oldIndex = current.findIndex((item) => item.id === replaceId);
          const old = current[oldIndex];
          current = [...current, { ...image, isCover: current.length === 0 }];
          setImages(current);
          if (replaceId && old) {
            const deletion = await fetch(`${endpoint}/${encodeURIComponent(replaceId)}`, { method: "DELETE" });
            const payload = await deletion.json().catch(() => null);
            if (!deletion.ok) throw new Error(payload?.error || "The new image was uploaded, but the original could not be replaced.");
            current = current.filter((item) => item.id !== replaceId && item.id !== image.id);
            current.splice(oldIndex, 0, { ...image, isCover: old.isCover });
            if (!current.some((item) => item.isCover) && current[0]) current[0] = { ...current[0], isCover: true };
            setImages(current);
            setDirty(true);
            await persist(current);
            setDirty(false);
          }
          setUploads((entries) => entries.map((entry) => entry.key === key ? { ...entry, progress: 100, status: "saved" } : entry));
        } catch (error) {
          setUploads((entries) => entries.map((entry) => entry.key === key ? { ...entry, status: "error", error: error instanceof Error ? error.message : "Image upload failed." } : entry));
        } finally { requests.current.delete(request); }
      }
    } finally { setPending(false); }
  }

  function reorder(id: string, targetIndex: number) {
    setImages((current) => {
      const start = current.findIndex((image) => image.id === id);
      if (start < 0 || targetIndex < 0 || targetIndex >= current.length || start === targetIndex) return current;
      const next = [...current]; const [image] = next.splice(start, 1); next.splice(targetIndex, 0, image); return next;
    });
    setDirty(true); setSaved(false);
  }

  async function save() {
    if (pending) return;
    setPending(true); setMessage(""); setSaved(false);
    try { await persist(images); setDirty(false); setSaved(true); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Image details could not be saved."); }
    finally { setPending(false); }
  }

  async function remove(imageId: string) {
    if (!canDelete || pending || !window.confirm("Remove this image from the product?")) return;
    setPending(true); setMessage(""); setSaved(false);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(imageId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Image could not be removed.");
      const next = images.filter((image) => image.id !== imageId);
      if (next.length && !next.some((image) => image.isCover)) next[0] = { ...next[0], isCover: true };
      setImages(next);
      if (next.length) { setDirty(true); await persist(next); }
      setDirty(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Image could not be removed."); }
    finally { setPending(false); }
  }

  return <div className={suppliesStyles.stack}>
    <div className={suppliesStyles.dropzone} data-dragging={dragging} onDragOver={(event) => { event.preventDefault(); if (!pending) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }}>
      <strong>Drag images here or choose multiple files</strong>
      <label><span className={styles.srOnly}>Upload product images</span><input aria-label="Upload product images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void upload(files); }} /></label>
      <p className={suppliesStyles.hint}>JPEG, PNG or WebP, up to {SUPPLIES_IMAGE_LIMITS.maximumBytes / (1024 * 1024)} MiB each. Each side must be 100–12,000 px, up to 40 megapixels. Content and dimensions are verified on the server.</p>
    </div>
    {uploads.length ? <ul className={suppliesStyles.uploadQueue} aria-label="Image upload progress">{uploads.map((entry) => <li key={entry.key}><strong>{entry.name}</strong>{entry.status === "uploading" ? <><progress aria-label={`Uploading ${entry.name}`} max={100} value={entry.progress} /><span role="status">{entry.progress === 100 ? "Processing image…" : `Uploading ${entry.progress}%`}</span></> : entry.status === "saved" ? <span role="status"> · Uploaded</span> : <p className={suppliesStyles.error} role="alert">{entry.error}</p>}</li>)}</ul> : null}
    {images.length ? <ol className={suppliesStyles.imageGrid} aria-label="Product image order">{images.map((image, index) => <li key={image.id} className={suppliesStyles.imageCard} data-cover={image.isCover} draggable={!pending} onDragStart={(event) => { dragImage.current = image.id; event.dataTransfer.setData("text/plain", image.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { dragImage.current = null; }} onDragOver={(event) => { if (dragImage.current) event.preventDefault(); }} onDrop={(event) => { if (!dragImage.current) return; event.preventDefault(); reorder(dragImage.current, index); dragImage.current = null; }}>
      <div className={suppliesStyles.thumbnail}><Image src={`/api/admin/supplies/images/${encodeURIComponent(image.id)}`} alt={image.altText} width={image.width} height={image.height} unoptimized /></div>
      {image.isCover ? <span className={suppliesStyles.cover}>Main / cover image</span> : <span className={suppliesStyles.hint}>Detail image {index + 1}</span>}
      <label><span>Alt text</span><input aria-label={`Image ${index + 1} alt text`} type="text" value={image.altText} maxLength={300} disabled={pending} onChange={(event) => { setImages((current) => current.map((item) => item.id === image.id ? { ...item, altText: event.target.value } : item)); setDirty(true); setSaved(false); }} /></label>
      <div className={suppliesStyles.actions}><button type="button" className={styles.secondaryAdminButton} disabled={pending || image.isCover} aria-label={`Set image ${index + 1} as cover`} onClick={() => { setImages((current) => current.map((item) => ({ ...item, isCover: item.id === image.id }))); setDirty(true); setSaved(false); }}>Set cover</button><button type="button" className={styles.secondaryAdminButton} disabled={pending || index === 0} aria-label={`Move image ${index + 1} earlier`} onClick={() => reorder(image.id, index - 1)}>←</button><button type="button" className={styles.secondaryAdminButton} disabled={pending || index === images.length - 1} aria-label={`Move image ${index + 1} later`} onClick={() => reorder(image.id, index + 1)}>→</button>{canDelete ? <button type="button" className={styles.secondaryAdminButton} disabled={pending || dirty} aria-label={`Delete image ${index + 1}`} onClick={() => void remove(image.id)}>Delete</button> : null}</div>
      {canDelete ? <label className={suppliesStyles.hint}><span>Replace image</span><input type="file" aria-label={`Replace image ${index + 1}`} accept="image/jpeg,image/png,image/webp" disabled={pending || dirty} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload([file], image.id); }} /><small>Save edited image details before replacing or deleting.</small></label> : null}
    </li>)}</ol> : <p className={suppliesStyles.hint}>No product images yet. Upload a cover and relevant product details.</p>}
    {message ? <p role="alert" className={suppliesStyles.error}>{message}</p> : null}{saved ? <p role="status" className={suppliesStyles.success}>Image details saved.</p> : null}
    {images.length ? <div className={suppliesStyles.actions}><button type="button" className={styles.primaryAdminButton} disabled={pending || !dirty} onClick={() => void save()}>Save image details</button>{dirty ? <span className={suppliesStyles.hint}>Alt text, cover and order changes are not saved yet.</span> : null}</div> : null}
  </div>;
}
