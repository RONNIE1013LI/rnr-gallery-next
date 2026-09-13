"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import css from "./gallery-artwork.module.css";

export function GalleryArtwork(props: ImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  return <span className={css.frame}>
    {state === "loading" ? <span role="status" className={css.loading}>Loading artwork…</span> : null}
    {state === "failed" ? <span role="img" aria-label={`${props.alt} — preview unavailable`} className={css.fallback}>Artwork preview unavailable</span> : <Image {...props} alt={props.alt} onLoad={() => setState("loaded")} onError={() => setState("failed")} />}
  </span>;
}
