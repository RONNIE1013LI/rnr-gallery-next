import Image from "next/image";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image
        className="brand-mark__logo"
        src="/media/brand/rr-gallery-logo-2026.webp"
        alt=""
        width={96}
        height={96}
      />
      <span className="brand-mark__copy">
        <span className="brand-mark__name">R&amp;R Gallery</span>
        <span className="brand-mark__line">Custom Prints NZ</span>
      </span>
    </span>
  );
}
