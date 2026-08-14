import Image from "next/image";

export function BrandMark({ imageSizes = "(max-width: 560px) 42px, 52px" }: Readonly<{ imageSizes?: string }>) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image
        className="brand-mark__logo"
        src="/media/brand/rr-gallery-logo-2026.webp"
        alt=""
        width={512}
        height={512}
        sizes={imageSizes}
      />
      <span className="brand-mark__copy">
        <span className="brand-mark__name">R&amp;R Gallery</span>
        <span className="brand-mark__line">Custom Prints NZ</span>
      </span>
    </span>
  );
}
