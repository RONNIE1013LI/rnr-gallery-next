import type { CustomerProofView } from "@/components/customer-proof-panel";

type ProofBundle = Readonly<{
  orderNumber: string;
  fulfilmentStatus: CustomerProofView["fulfilmentStatus"];
  files: readonly Readonly<{
    id: string;
    version: number;
    originalName: string;
    mediaType: string;
    sizeBytes: number;
    createdAt: Date;
    review: null | Readonly<{
      id: string;
      decision: "approved" | "changes_requested";
      notes: string;
      reviewerType: "staff" | "customer";
      createdAt: Date;
    }>;
  }>[];
  revision: CustomerProofView["revision"];
}>;

export function toCustomerProofView(bundle: ProofBundle): CustomerProofView {
  return Object.freeze({
    orderNumber: bundle.orderNumber,
    fulfilmentStatus: bundle.fulfilmentStatus,
    revision: Object.freeze({ ...bundle.revision }),
    files: Object.freeze(bundle.files.map((file) => Object.freeze({
      ...file,
      createdAt: file.createdAt.toISOString(),
      review: file.review ? Object.freeze({
        ...file.review,
        createdAt: file.review.createdAt.toISOString(),
      }) : null,
    }))),
  });
}
