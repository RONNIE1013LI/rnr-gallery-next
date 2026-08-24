"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LuChevronRight, LuSearch } from "react-icons/lu";

import type {
  FormFilterGroup,
  FormWorkbenchQuery,
  FormWorkbenchResult,
} from "@/server/forms/forms-workbench-service";
import { encodeFormFilterCondition } from "@/server/forms/forms-workbench-service";
import { FormsFilterBuilder, type FormsFilterCustomField } from "./forms-filter-builder";
import { FormsJobDrawer } from "./forms-job-drawer";
import { FormsOrderEntryDrawer } from "./forms-order-entry-drawer";
import { FormsOrderCards } from "./forms-order-cards";
import { FormsOrderTable } from "./forms-order-table";
import { FormsSavedViews } from "./forms-saved-views";
import type { ProductionSavedView } from "@/server/production/production-saved-view-service";
import type { ProductionFormField } from "@/components/admin/production-job-form";
import type { InvoiceBusiness } from "@/server/invoices/invoice-business";
import styles from "./forms.module.css";

export type FormsOrderEntryData = Readonly<{
  assignees: readonly Readonly<{ id: string; name: string; email: string; role: "admin" | "staff" | "form_staff" }>[];
  canManageFinance: boolean;
  canUploadFiles: boolean;
  submittedBy: string;
  productTitles: readonly string[];
  customFields: readonly ProductionFormField[];
  invoiceBusiness: InvoiceBusiness;
}>;

function queryString(query: FormWorkbenchQuery, page?: number) {
  const params = new URLSearchParams();
  if (query.query) params.set("q", query.query);
  if (query.pageSize !== 100) params.set("perPage", String(query.pageSize));
  if (query.match !== "and") params.set("match", query.match);
  if (query.sort !== "submittedAt") params.set("sort", query.sort);
  if (query.direction !== "desc") params.set("direction", query.direction);
  if (query.preset !== "all") params.set("preset", query.preset);
  for (const condition of query.conditions) {
    params.append("filter", encodeFormFilterCondition(condition));
  }
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export function FormsWorkbench({
  result,
  query,
  canViewFinance,
  canViewCustomerContact = false,
  canViewPaymentProof = false,
  filterCustomFields = [],
  filterPeople = [],
  canManageViews = false,
  savedViews = [],
  canUpdate = false,
  canUpdateFinance = false,
  canUpdateProductionStatus = false,
  canUpdateDeliveryStatus = false,
  canViewFiles = false,
  canUploadFiles = false,
  canReviewProofs = false,
  canDeleteFiles = false,
  canDeleteJobs = false,
  assignees = [],
  orderEntry,
}: Readonly<{
  result: FormWorkbenchResult;
  query: FormWorkbenchQuery;
  canExport: boolean;
  canViewFinance: boolean;
  canViewCustomerContact?: boolean;
  canViewPaymentProof?: boolean;
  filterCustomFields?: readonly FormsFilterCustomField[];
  filterPeople?: readonly Readonly<{ id: string; name: string }>[];
  canManageViews?: boolean;
  savedViews?: readonly ProductionSavedView[];
  canUpdate?: boolean;
  canUpdateFinance?: boolean;
  canUpdateProductionStatus?: boolean;
  canUpdateDeliveryStatus?: boolean;
  canViewFiles?: boolean;
  canUploadFiles?: boolean;
  canReviewProofs?: boolean;
  canDeleteFiles?: boolean;
  canDeleteJobs?: boolean;
  assignees?: readonly Readonly<{ id: string; name: string; email: string; role: "admin" | "staff" | "form_staff" }>[];
  orderEntry?: FormsOrderEntryData;
}>) {
  const router = useRouter();
  const [showColumnStats, setShowColumnStats] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const visibleStats = {
    urgent: result.items.filter((row) => row.urgent).length,
    completed: result.items.filter((row) => row.milestones.completed).length,
    post: result.items.filter((row) => row.deliveryMethod === "post").length,
    pickup: result.items.filter((row) => row.deliveryMethod === "pickup").length,
    payable: result.items.reduce((sum, row) => sum + (row.finance?.amountPayableCents ?? 0), 0),
    paid: result.items.reduce((sum, row) => sum + (row.finance?.amountPaidCents ?? 0), 0),
    owing: result.items.reduce((sum, row) => sum + (row.finance?.amountOwingCents ?? 0), 0),
  };

  function open(jobId: string) {
    setActiveJobId(jobId);
  }

  function applyFilters(group: FormFilterGroup) {
    router.push(`/order-system${queryString({ ...query, match: group.match, conditions: group.conditions }) ? `?${queryString({ ...query, match: group.match, conditions: group.conditions })}` : ""}`);
  }

  function closeOrderEntry() {
    const next = queryString(query, result.page);
    router.replace(`/order-system${next ? `?${next}` : ""}`);
  }

  return (
    <section className={styles.workbench}>
      <h1 className={styles.visuallyHidden}>Order system data list</h1>
      <div className={styles.listToolbar}>
        <form className={styles.quickSearch} method="get">
          <label>
            <span className={styles.visuallyHidden}>Search Ref No. / Cust.Name</span>
            <LuSearch className={styles.quickSearchIcon} aria-hidden="true" />
            <input
              aria-label="Search Ref No. / Cust.Name"
              defaultValue={query.query}
              name="q"
              placeholder="Search name / order no."
              type="search"
            />
          </label>
          <button type="submit" aria-label="Search orders"><span className={styles.quickSearchButtonText}>Search</span><LuChevronRight className={styles.quickSearchButtonIcon} aria-hidden="true" /></button>
        </form>
        <FormsFilterBuilder
          conditions={query.conditions}
          match={query.match}
          canViewFinance={canViewFinance}
          canViewCustomerContact={canViewCustomerContact}
          canViewPaymentProof={canViewPaymentProof}
          people={filterPeople}
          customFields={filterCustomFields}
          preset={query.preset}
          onPresetChange={(preset) => {
            const next = queryString({ ...query, preset });
            router.push(`/order-system${next ? `?${next}` : ""}`);
          }}
          renderSavedSearches={canManageViews ? (group, closeFilters) => <FormsSavedViews
            views={savedViews}
            currentQuery={group ? queryString({ ...query, query: "", pageSize: 100, match: group.match, conditions: group.conditions }) : ""}
            onOpen={(savedQuery) => {
              closeFilters();
              router.push(`/order-system?${savedQuery}`);
            }}
            onChanged={() => router.refresh()}
          /> : undefined}
          onApply={applyFilters}
        />
        <span className={styles.toolbarSpacer} />
      </div>

      <div className={styles.listBody} role="region" aria-label="Order results">
        {result.items.length ? (
          <>
            <FormsOrderTable
              rows={result.items}
              startIndex={(result.page - 1) * query.pageSize}
              canViewFinance={canViewFinance}
              canUpdate={canUpdate}
              canUpdateFinance={canUpdateFinance}
              canUpdateProductionStatus={canUpdateProductionStatus}
              canUpdateDeliveryStatus={canUpdateDeliveryStatus}
              assignees={assignees}
              onOpen={open}
              onSaved={() => router.refresh()}
            />
            <FormsOrderCards rows={result.items} startIndex={(result.page - 1) * query.pageSize} canViewFinance={canViewFinance} onOpen={open} />
          </>
        ) : (
          <div className={styles.formsEmptyState}>
            <h1>No orders match these filters.</h1>
            <p>Clear the current search or filters to return to the full data list.</p>
            <Link href="/order-system">Clear filters</Link>
          </div>
        )}

        {showColumnStats ? <section className={styles.columnStatsPanel} aria-label="Visible column statistics">
          <header><strong>Visible rows</strong><span>Current page only · use Custom stats for all matching orders</span></header>
          <dl>
            <div><dt>Displayed</dt><dd>{result.items.length}</dd></div>
            <div><dt>Urgent</dt><dd>{visibleStats.urgent}</dd></div>
            <div><dt>Completed</dt><dd>{visibleStats.completed}</dd></div>
            <div><dt>Post</dt><dd>{visibleStats.post}</dd></div>
            <div><dt>Pickup</dt><dd>{visibleStats.pickup}</dd></div>
            {canViewFinance ? <><div><dt>Amount payable</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.payable / 100)}</dd></div><div><dt>Amount paid</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.paid / 100)}</dd></div><div><dt>Amount owing</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.owing / 100)}</dd></div></> : null}
          </dl>
        </section> : null}
      </div>

      <footer className={styles.listFooter}>
        <strong>{result.total} {result.total === 1 ? "order" : "orders"}</strong>
        <button type="button" onClick={() => setShowColumnStats((visible) => !visible)}>Column stats</button>
        {showColumnStats ? <span className={styles.columnStatsSummary}>Showing {result.items.length} of {result.total}</span> : null}
        <nav aria-label="Order pages">
          {result.page > 1 ? <Link href={`/order-system?${queryString(query, result.page - 1)}`}>Previous</Link> : <span />}
          <span>{result.pageCount ? `${result.page} / ${result.pageCount}` : "0 / 0"}</span>
          {result.page < result.pageCount ? <Link href={`/order-system?${queryString(query, result.page + 1)}`}>Next</Link> : <span />}
        </nav>
        <div className={styles.perPageControl}>
          <label>
            <span className={styles.visuallyHidden}>Orders per page</span>
            <select
              aria-label="Orders per page"
              value={String(query.pageSize)}
              name="perPage"
              onChange={(event) => {
                const pageSize = Number(event.target.value) as FormWorkbenchQuery["pageSize"];
                const next = queryString({ ...query, pageSize });
                router.push(`/order-system${next ? `?${next}` : ""}`);
              }}
            >
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
          </label>
        </div>
      </footer>
      {activeJobId ? <FormsJobDrawer
        jobId={activeJobId}
        onClose={() => setActiveJobId(null)}
        assignees={assignees}
        canManageFinance={canUpdateFinance}
        canUpdate={canUpdate}
        canViewFiles={canViewFiles}
        canUploadFiles={canUploadFiles}
        canReviewProofs={canReviewProofs}
        canUpdateDeliveryStatus={canUpdateDeliveryStatus}
        canDeleteFiles={canDeleteFiles}
        canDeleteJob={canDeleteJobs}
        onSaved={() => router.refresh()}
      /> : null}
      {orderEntry ? <FormsOrderEntryDrawer data={orderEntry} onClose={closeOrderEntry} /> : null}
    </section>
  );
}
