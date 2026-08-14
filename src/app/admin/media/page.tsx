import Image from "next/image";
import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { listAdminMedia } from "@/server/admin/admin-media-service";
import { requireAdminPage } from "@/server/auth/require-admin-page";

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function AdminMediaPage() {
  await requireAdminPage("/admin/media", "delete_media");
  const media = await listAdminMedia();
  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Media</span></nav><h1>Media</h1><p>Real storefront and Design Gallery assets. Private customer uploads are deliberately excluded from the general media library.</p></div><span className={styles.recordCount}>{media.storefront.length + media.gallery.length} assets</span></header>
    <div className={styles.safetyBanner} role="note"><strong>{media.missingProductMedia.length ? `${media.missingProductMedia.length} product image reference(s) are missing.` : "All product image references are healthy."}</strong><p>{media.missingProductMedia.length ? media.missingProductMedia.map((item) => `${item.title}: ${item.imageSrc}`).join(" · ") : "New product publications are blocked unless the selected image exists in managed storefront media. Deletion remains locked so a live page cannot be broken accidentally."}</p></div>
    <section className={styles.panel}><div className={styles.panelHeading}><h2>Storefront assets</h2><span>{media.storefront.length}</span></div>{media.storefront.length ? <div className={styles.mediaGrid}>{media.storefront.map((file) => <article key={file.url}><div><Image src={file.url} alt="" fill sizes="180px" /></div><strong>{file.name}</strong><small>{formatBytes(file.sizeBytes)}{file.usedBy?.length ? ` · ${file.usedBy.join(", ")}` : " · Static page asset"}</small></article>)}</div> : <p className={styles.mutedText}>No images were found under public/media.</p>}</section>
    <section className={styles.panel}><div className={styles.panelHeading}><h2>Managed Design Gallery assets</h2><Link href="/admin/design-gallery">Manage gallery</Link></div>{media.gallery.length ? <div className={styles.mediaGrid}>{media.gallery.map((design) => <article key={design.id}><div><Image src={design.imageUrl} alt={design.altText} fill sizes="180px" /></div><strong>{design.altText}</strong><small>{design.status} · {design.productTypeSlug}</small></article>)}</div> : <p className={styles.mutedText}>No gallery designs.</p>}</section>
  </section>;
}
