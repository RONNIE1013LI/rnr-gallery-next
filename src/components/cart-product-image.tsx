"use client";

import Image from "next/image";
import { useState } from "react";
import { products } from "@/domain/catalogue/products";
import styles from "./storefront.module.css";

export function CartProductImage({ src, productSlug, title }: {
  src: string;
  productSlug: string;
  title: string;
}) {
  const imageSrc = src || products.find((product) => product.slug === productSlug)?.image.src;
  const [failedSource, setFailedSource] = useState<string>();
  if (!imageSrc || failedSource === imageSrc) {
    return <div className={styles.cartImageFallback} role="img" aria-label={`${title} preview unavailable`}>
      <span aria-hidden="true">Custom artwork</span>
    </div>;
  }
  return <Image src={imageSrc} alt="" width={96} height={96} onError={() => setFailedSource(imageSrc)} />;
}
