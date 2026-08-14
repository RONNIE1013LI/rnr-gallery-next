import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { formatNzd } from "@/domain/money";
import { formatOrderDate, orderPaymentStatusLabels } from "@/components/order-detail";
import { requireAccountPage } from "@/server/auth/require-account-page";
import { getDatabase } from "@/server/db/client";
import {
  createDrizzleOrderQueryRepository,
  OrderSnapshotIntegrityError,
} from "@/server/orders/drizzle-order-query-repository";

type Props = Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

function positivePage(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AccountOrdersPage({
  searchParams = Promise.resolve({}),
}: Props) {
  const rawPage = (await searchParams).page;
  const scalarPage = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const requestedPath = scalarPage
    ? `/account/orders?page=${encodeURIComponent(scalarPage)}`
    : "/account/orders";
  const session = await requireAccountPage(requestedPath);
  const page = positivePage(rawPage);
  let result;
  try {
    result = await createDrizzleOrderQueryRepository(getDatabase())
      .listPageByCustomer(session.user.id, page);
  } catch (error) {
    if (error instanceof OrderSnapshotIntegrityError) notFound();
    throw error;
  }

  return (
    <main id="main-content" className={styles.orderPage}>
      <header>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Your orders.</h1>
      </header>
      {result.items.length ? (
        <>
          <ul className={styles.orderHistory}>
            {result.items.map((order) => (
              <li key={order.orderNumber}>
                <Link href={`/account/orders/${order.orderNumber}`}>
                  <strong>{order.orderNumber}</strong>
                  <span>{formatOrderDate(order.createdAt)}</span>
                  <span>{orderPaymentStatusLabels[order.paymentStatus]}</span>
                  <span>{formatNzd(order.totals.totalInclGstCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {result.pageCount > 1 ? (
            <nav className={styles.orderPagination} aria-label="Order history pages">
              {result.page > 1
                ? <Link href={`/account/orders?page=${result.page - 1}`} aria-label="Previous orders">Previous</Link>
                : <span />}
              <span>Page {result.page} of {result.pageCount}</span>
              {result.page < result.pageCount
                ? <Link href={`/account/orders?page=${result.page + 1}`} aria-label="Next orders">Next</Link>
                : <span />}
            </nav>
          ) : null}
        </>
      ) : (
        <section className={styles.cartEmpty}>
          <h2>No orders yet</h2>
          <p>Your completed checkout orders will appear here.</p>
          <Link className={styles.primaryButton} href="/shop">Explore products</Link>
        </section>
      )}
    </main>
  );
}
