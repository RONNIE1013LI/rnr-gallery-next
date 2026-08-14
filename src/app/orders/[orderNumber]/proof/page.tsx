import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerProofPanel } from "@/components/customer-proof-panel";
import styles from "@/components/storefront.module.css";
import { resolveCustomerProofRequestAccess } from "@/server/production/customer-proof-request-access";
import { getCustomerProofRuntime } from "@/server/production/customer-proof-runtime";
import { ProductionProofNotFoundError } from "@/server/production/production-proof-service";
import { toCustomerProofView } from "@/server/production/customer-proof-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = Readonly<{
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{
    file?: string | string[];
    expires?: string | string[];
    signature?: string | string[];
  }>;
}>;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CustomerProofPage({ params, searchParams }: Props) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);
  const fileId = scalar(query.file) ?? null;
  const expires = scalar(query.expires) ?? null;
  const signature = scalar(query.signature) ?? null;
  const access = await resolveCustomerProofRequestAccess({
    orderNumber,
    fileId,
    expires,
    signature,
  });
  if (!access) notFound();
  let proof;
  try {
    proof = await getCustomerProofRuntime().listCustomerProofs(orderNumber, access);
  } catch (error) {
    if (error instanceof ProductionProofNotFoundError) notFound();
    throw error;
  }
  if (!proof.files.length) notFound();
  return (
    <main id="main-content" className={styles.orderPage}>
      <CustomerProofPanel
        proof={toCustomerProofView(proof)}
        access={access.kind === "signed" && expires && signature
          ? { expires, signature }
          : undefined}
      />
      <section className={styles.orderNext}>
        <h2>Need help?</h2>
        <p>Contact R&R Gallery before approving if anything in the draft is unclear.</p>
        <div>
          <Link className={styles.secondaryButton} href={`https://m.me/RandRgallery`}>
            Message R&R
          </Link>
          <Link className={styles.secondaryButton} href={`/orders/${encodeURIComponent(orderNumber)}`}>
            View order
          </Link>
        </div>
      </section>
    </main>
  );
}
