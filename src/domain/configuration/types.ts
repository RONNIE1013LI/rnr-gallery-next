export type Orientation = "landscape" | "portrait";
export type OrientationMode = "choice" | "fixed" | "none";
export type DeliveryPreference = "post" | "pickup";
export type PhotoSubmissionMethod = "upload" | "later";

export const MAX_SOURCE_PHOTOS_PER_ITEM = 50;

export type ConfigurationSize = Readonly<{
  key: string;
  label: string;
  priceExGstCents: number;
  nzAmountInclTaxCents?: number;
}>;

export type ProductConfigurationSchema = Readonly<{
  productKey: string;
  sizes: readonly ConfigurationSize[];
  defaultSizeKey: string;
  orientationMode: OrientationMode;
  defaultOrientation?: Orientation;
  peoplePetsMode: "required" | "none";
  defaultPeoplePets: number;
  minimumSourcePhotos: number;
  maximumSourcePhotos?: number;
  includedPhotos: number;
  artworkDirectionMode: "required" | "none";
  extraPhotoPriceExGstCents?: number;
  extraBackgroundRemovalFeeInclGstCents?: number;
  deliveryPreferences: readonly DeliveryPreference[];
  defaultDeliveryPreference: DeliveryPreference;
  defaultPhotoSubmissionMethod: PhotoSubmissionMethod;
}>;

export type ProductConfigurationSelection = Readonly<{
  sizeKey: string;
  orientation?: Orientation;
  peoplePets: number;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  neededDate: string;
  deliveryPreference: DeliveryPreference;
}>;
