export type HomepageV3ImageSlot = Readonly<{
  src: string | null;
  alt: string;
}>;

const slot = (
  alt: string,
  src: string | null = null,
): HomepageV3ImageSlot => Object.freeze({ src, alt });

/**
 * Replace only the `src` values when approved photography is ready.
 * Null sources intentionally render the approved V3 artwork compositions.
 */
export const homepageV3ImageSlots = Object.freeze({
  heroFinishedArtwork: slot(
    "Finished custom family artwork created by R&R Gallery",
    "/media/home/homepage-hero-finished-artwork.webp",
  ),
  heroRealMoment: slot(
    "Customer standing beside her personalised family canvas",
    "/media/home/homepage-hero-real-customer-moment.webp",
  ),
  heroPrintedProduct: slot(
    "Personalised family artwork printed and displayed as a canvas",
    "/media/home/homepage-hero-printed-canvas.webp",
  ),
  beginProductFormats: slot(
    "Canvas, wall banner and roll-up banner product formats",
    "/media/home/homepage-begin-product-formats-v2.webp",
  ),
  beginOccasions: slot(
    "Birthday, memorial and family occasion settings",
    "/media/home/homepage-begin-occasions.webp",
  ),
  beginPhotoHelp: slot(
    "Customer photographs ready for artwork design",
    "/media/home/homepage-begin-photo-help.webp",
  ),
  signatureOriginalPhotos: Object.freeze([
    slot(
      "First original photograph in the featured family transformation",
      "/media/home/homepage-signature-photo-01.webp",
    ),
    slot(
      "Second original photograph in the featured family transformation",
      "/media/home/homepage-signature-photo-02.webp",
    ),
    slot(
      "Third original photograph in the featured family transformation",
      "/media/home/homepage-signature-photo-03.webp",
    ),
  ]),
  signatureFinishedArtwork: slot(
    "Finished family canvas created from the three source photographs",
    "/media/home/homepage-signature-family-artwork-v2.webp",
  ),
  canvasProductImage: slot(
    "Custom family canvas displayed in a gallery interior",
    "/media/home/homepage-product-canvas.webp",
  ),
  wallBannerProductImage: slot(
    "Custom fifth birthday wall banner displayed indoors",
    "/media/home/homepage-product-wall-banner-birthday.webp",
  ),
  rollupProductImage: slot(
    "Memorial birthday roll-up banner shown with its display stand",
    "/media/home/homepage-product-roll-up-banner.webp",
  ),
  graveCoverProductImage: slot(
    "Personalised memorial grave cover displayed on grass",
    "/media/home/homepage-product-grave-cover.webp",
  ),
  galleryBirthday: slot("Birthday wall banner design"),
  galleryMemorial: slot("Memorial grave cover design"),
  galleryFamily: slot("Custom family canvas design"),
  galleryCultural: slot("Cultural celebration banner design"),
});
