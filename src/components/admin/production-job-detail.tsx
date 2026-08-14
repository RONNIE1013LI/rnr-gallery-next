import type { getProductionJobDetail, ProductionAssignee } from "@/server/production/drizzle-production-job-repository";
import { ProductionJobControls } from "./production-job-controls";
import { ProductionFilesPanel } from "./production-files-panel";
import { InvoicePanel } from "./invoice-panel";
import type { ProductionFileSummary } from "@/server/production/production-proof-service";
import type { CustomerNotificationSummary } from "@/server/notifications/customer-notification-service";
import styles from "./admin.module.css";

type Detail = NonNullable<Awaited<ReturnType<typeof getProductionJobDetail>>>;
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const dateTime = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" });

function amount(cents: number) {
  return money.format(cents / 100);
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProductionJobDetail({
  detail,
  assignees,
  canManageFinance,
  files = [],
  notifications = [],
  revision = { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false },
  jobApiBase = "/api/admin/jobs",
  invoicePdfBase = "/api/admin/invoices",
  orderBasePath = "/admin/orders",
  notificationRetryEndpoint = "/api/admin/notifications/retry",
  canUploadFiles = true,
  canReviewProofs = true,
  canRetryNotifications = true,
  canUpdateJob = true,
}: Readonly<{
  detail: Detail;
  assignees: readonly ProductionAssignee[];
  canManageFinance: boolean;
  files?: readonly ProductionFileSummary[];
  notifications?: readonly CustomerNotificationSummary[];
  revision?: Readonly<{ changesRequested: number; freeRevisionsRemaining: number; requiresAdditionalChargeReview: boolean }>;
  jobApiBase?: string;
  invoicePdfBase?: string;
  orderBasePath?: string | null;
  notificationRetryEndpoint?: string;
  canUploadFiles?: boolean;
  canReviewProofs?: boolean;
  canRetryNotifications?: boolean;
  canUpdateJob?: boolean;
}>) {
  const { job } = detail;
  const customFields = detail.customFields ?? [];
  const currentCustomFields = customFields.filter((field) => !field.legacyOnly);
  const legacyFields = customFields.filter((field) => field.legacyOnly);
  const milestones = [
    ["File sent", job.fileSentAt],
    ["Downloaded", job.downloadedAt],
    ["Printed", job.printedAt],
    ["Customer notified", job.customerNotifiedAt],
    ["Delivered", job.deliveredAt],
    ["Artist paid", job.artistPaidAt],
    ["Completed", job.completedAt],
  ] as const;
  return (
    <div className={styles.orderDetailLayout}>
      <div className={styles.detailMain}>
        <section className={styles.summaryGrid}>
          <div><span>Status</span><strong>{label(detail.status)}</strong></div>
          <div><span>Payment</span><strong>{label(detail.paymentStatus)}</strong></div>
          <div><span>Needed date</span><strong>{job.neededDate}</strong></div>
          <div><span>Assigned</span><strong>{detail.assignee?.name ?? "Unassigned"}</strong></div>
        </section>

        {job.source === "web" && job.orderId ? <section className={styles.authorityBanner}><div><strong>Linked online order</strong><p>Checkout pricing, payment and order status remain authoritative in {detail.orderNumber}.</p></div></section> : null}

        <ProductionFilesPanel
          jobId={job.id}
          files={files}
          notifications={notifications}
          revision={revision}
          canManageFinance={canManageFinance}
          jobApiBase={jobApiBase}
          notificationRetryEndpoint={notificationRetryEndpoint}
          canUploadFiles={canUploadFiles}
          canReviewProofs={canReviewProofs}
          canRetryNotifications={canRetryNotifications}
        />

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Customer</h2><span>{label(job.customerSource)}</span></div>
          <dl className={styles.definitionGrid}>
            <div><dt>Name</dt><dd>{job.customerName}</dd></div>
            <div><dt>Email</dt><dd>{job.customerEmail || "Not supplied"}</dd></div>
            <div><dt>Phone</dt><dd>{job.customerPhone || "Not supplied"}</dd></div>
            <div><dt>Delivery</dt><dd>{label(job.deliveryMethod)}</dd></div>
            <div><dt>Delivery address</dt><dd className={styles.preWrapText}>{job.deliveryAddress || "Not supplied"}</dd></div>
            <div><dt>Web order number</dt><dd>{job.webOrderNumber || detail.orderNumber || "Not supplied"}</dd></div>
            <div><dt>Priority</dt><dd>{job.urgent ? "Urgent — customer confirmed" : "Standard"}</dd></div>
            <div><dt>Created</dt><dd>{dateTime.format(job.createdAt)}</dd></div>
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Production items</h2><span>{detail.items.length} item{detail.items.length === 1 ? "" : "s"}</span></div>
          {detail.items.map((item) => <article className={styles.orderItem} key={item.id}>
            <div className={styles.orderItemHeading}><div><h3>{item.productTitle}</h3><p>{item.sizeLabel}</p></div><strong>Qty {item.quantity}</strong></div>
            {item.designText ? <div className={styles.customerText}><strong>Artwork direction</strong><p>{item.designText}</p></div> : null}
            {item.notes ? <div className={styles.customerText}><strong>Item notes</strong><p>{item.notes}</p></div> : null}
          </article>)}
        </section>

        <section className={styles.twoColumnPanels}>
          <article className={styles.panel}><h2>Design requirements</h2><p className={styles.preWrapText}>{job.designRequirements || "No separate requirements recorded."}</p></article>
          <article className={styles.panel}><h2>Internal notes</h2><p className={styles.preWrapText}>{job.internalNotes || "No internal notes recorded."}</p></article>
        </section>

        {currentCustomFields.length ? <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Custom fields</h2><span>Studio information</span></div>
          <dl className={styles.definitionGrid}>{currentCustomFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd className={styles.preWrapText}>{field.value || "—"}</dd></div>)}</dl>
        </section> : null}

        {legacyFields.length ? <details className={styles.panel}>
          <summary><strong>Legacy eTeams history</strong><span>{legacyFields.length} retained field{legacyFields.length === 1 ? "" : "s"}</span></summary>
          <dl className={styles.definitionGrid}>{legacyFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd className={styles.preWrapText}>{field.value || "—"}</dd></div>)}</dl>
        </details> : null}

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Milestone history</h2><span>Production handoff</span></div>
          <div className={styles.milestoneGrid}>{milestones.map(([name, value]) => <div key={name} data-complete={Boolean(value)}><span aria-hidden="true">{value ? "✓" : "—"}</span><strong>{name}</strong><small>{value ? dateTime.format(value) : "Not complete"}</small></div>)}</div>
        </section>

        {detail.finance ? <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Finance summary</h2><span>{job.source === "web" ? "Read-only online total" : "Administrator only"}</span></div>
          <div className={styles.orderTotals}>
            <div><span>Amount payable</span><strong>{amount(detail.finance.amountPayableCents)}</strong></div>
            <div><span>Amount paid</span><strong>{amount(detail.finance.amountPaidCents)}</strong></div>
            <div><span>Amount owing</span><strong>{amount(detail.finance.amountOwingCents)}</strong></div>
            {detail.finance.artistFeeCents !== null ? <div><span>Artist fee</span><strong>{amount(detail.finance.artistFeeCents)}</strong></div> : null}
            {detail.finance.materialCostCents !== null ? <div><span>Material cost</span><strong>{amount(detail.finance.materialCostCents)}</strong></div> : null}
            {detail.finance.actualProfitCents !== null ? <div><span>Actual profit</span><strong>{amount(detail.finance.actualProfitCents)}</strong></div> : null}
            <div><span>Payment reconciliation</span><strong>{job.paymentReconciliationStatus}</strong></div>
          </div>
        </section> : null}

        {detail.finance ? <InvoicePanel jobId={job.id} jobApiBase={jobApiBase} invoicePdfBase={invoicePdfBase} canEdit={canManageFinance} /> : null}

        <section className={styles.panel}>
          <h2>Activity</h2>
          {detail.audit.length ? <div className={styles.timeline}>{detail.audit.map((entry) => <article key={entry.id}><strong>{label(entry.action.replaceAll(".", "_"))}</strong><span>{entry.actorEmail}</span><small>{dateTime.format(entry.createdAt)}</small></article>)}</div> : <p className={styles.mutedText}>No production updates recorded after creation.</p>}
        </section>
      </div>

      {canUpdateJob ? <aside className={styles.detailAside}>
        <ProductionJobControls
          jobId={job.id}
          source={job.source}
          orderId={job.orderId}
          expectedUpdatedAt={job.updatedAt.toISOString()}
          status={detail.status}
          paymentStatus={detail.paymentStatus}
          assignedUserId={job.assignedUserId}
          urgent={job.urgent}
          neededDate={job.neededDate}
          deliveryMethod={job.deliveryMethod}
          deliveryAddress={job.deliveryAddress}
          paymentReconciliationStatus={job.paymentReconciliationStatus}
          designRequirements={job.designRequirements}
          internalNotes={job.internalNotes}
          milestones={{
            fileSent: Boolean(job.fileSentAt),
            downloaded: Boolean(job.downloadedAt),
            printed: Boolean(job.printedAt),
            customerNotified: Boolean(job.customerNotifiedAt),
            delivered: Boolean(job.deliveredAt),
            artistPaid: Boolean(job.artistPaidAt),
            completed: Boolean(job.completedAt),
          }}
          finance={detail.finance}
          assignees={assignees}
          canManageFinance={canManageFinance}
          customFields={currentCustomFields.filter((field) => field.fieldType !== "file").map((field) => ({
            id: field.id,
            label: field.label,
            fieldType: field.fieldType,
            options: field.options,
            required: field.required,
            value: field.value,
          }))}
          jobApiBase={jobApiBase}
          orderBasePath={orderBasePath}
        />
      </aside> : null}
    </div>
  );
}
