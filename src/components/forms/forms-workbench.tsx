"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuArrowUp, LuChevronRight, LuSearch } from "react-icons/lu";

import type {
  FormFilterGroup,
  FormWorkbenchQuery,
  FormWorkbenchResult,
} from "@/server/forms/forms-workbench-service";
import { encodeFormFilterCondition, parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
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

const MOBILE_BACK_TO_TOP_THRESHOLD = 600;
const ORDER_UPDATE_INDICATOR_DELAY_MS = 300;

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

function queryFromSearchParams(params: URLSearchParams) {
  return parseFormWorkbenchQuery(Object.fromEntries(
    [...params.keys()].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  ));
}

function orderListUrl(query: FormWorkbenchQuery, page?: number) {
  const search = queryString(query, page);
  return `/order-system${search ? `?${search}` : ""}`;
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
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [localView, setLocalView] = useState<Readonly<{
    source: FormWorkbenchResult;
    query: FormWorkbenchQuery;
    result: FormWorkbenchResult;
  }> | null>(null);
  const [showUpdating, setShowUpdating] = useState(false);
  const [showRefreshing, setShowRefreshing] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [retryTarget, setRetryTarget] = useState<Readonly<{ query: FormWorkbenchQuery; page?: number }> | null>(null);
  const navigationSequence = useRef(0);
  const activeNavigation = useRef<AbortController | null>(null);
  const activeRefresh = useRef<AbortController | null>(null);
  const indicatorTimer = useRef<number | null>(null);
  const currentQuery = localView?.source === result ? localView.query : query;
  const currentResult = localView?.source === result ? localView.result : result;
  const refreshQuery = queryString(currentQuery, currentResult.page);
  const refreshEndpoint = `/api/forms/jobs${refreshQuery ? `?${refreshQuery}` : ""}`;
  const visibleStats = {
    urgent: currentResult.items.filter((row) => row.urgent).length,
    completed: currentResult.items.filter((row) => row.milestones.completed).length,
    post: currentResult.items.filter((row) => row.deliveryMethod === "post").length,
    pickup: currentResult.items.filter((row) => row.deliveryMethod === "pickup").length,
    payable: currentResult.items.reduce((sum, row) => sum + (row.finance?.amountPayableCents ?? 0), 0),
    paid: currentResult.items.reduce((sum, row) => sum + (row.finance?.amountPaidCents ?? 0), 0),
    owing: currentResult.items.reduce((sum, row) => sum + (row.finance?.amountOwingCents ?? 0), 0),
  };

  function open(jobId: string) {
    setActiveJobId(jobId);
  }

  function applyFilters(group: FormFilterGroup) {
    void updateOrders({ ...currentQuery, match: group.match, conditions: group.conditions }, 1);
  }

  function closeOrderEntry() {
    const next = queryString(currentQuery, currentResult.page);
    router.replace(`/order-system${next ? `?${next}` : ""}`);
  }

  const updateOrders = useCallback(async (
    nextQuery: FormWorkbenchQuery,
    page = 1,
    historyMode: "push" | "none" = "push",
  ) => {
    const sequence = navigationSequence.current + 1;
    navigationSequence.current = sequence;
    activeNavigation.current?.abort();
    const controller = new AbortController();
    activeNavigation.current = controller;
    const nextUrl = orderListUrl(nextQuery, page);

    if (indicatorTimer.current !== null) window.clearTimeout(indicatorTimer.current);
    setShowUpdating(false);
    indicatorTimer.current = window.setTimeout(
      () => setShowUpdating(true),
      ORDER_UPDATE_INDICATOR_DELAY_MS,
    );
    setUpdateError("");
    setRetryTarget(null);

    try {
      const response = await fetch(nextUrl.replace("/order-system", "/api/forms/jobs"), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as FormWorkbenchResult & { error?: string };
      if (response.status === 401 || response.status === 403) {
        router.replace("/order-system");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "The order list could not be updated.");
      if (controller.signal.aborted || navigationSequence.current !== sequence) return;

      setLocalView({ source: result, query: nextQuery, result: payload });
      if (historyMode === "push") window.history.pushState(window.history.state, "", nextUrl);
    } catch (error) {
      if (controller.signal.aborted || navigationSequence.current !== sequence) return;
      setUpdateError(error instanceof Error ? error.message : "The order list could not be updated.");
      setRetryTarget({ query: nextQuery, page });
    } finally {
      if (navigationSequence.current === sequence) {
        if (indicatorTimer.current !== null) window.clearTimeout(indicatorTimer.current);
        indicatorTimer.current = null;
        setShowUpdating(false);
      }
      if (activeNavigation.current === controller) activeNavigation.current = null;
    }
  }, [result, router]);

  const refreshOrders = useCallback(async () => {
    activeRefresh.current?.abort();
    const controller = new AbortController();
    activeRefresh.current = controller;
    setShowRefreshing(true);

    try {
      const response = await fetch(refreshEndpoint, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return;

      const nextResult = await response.json() as FormWorkbenchResult;
      if (!controller.signal.aborted) {
        setLocalView((current) => {
          const activeQuery = current?.source === result ? current.query : query;
          const activeResult = current?.source === result ? current.result : result;
          return queryString(activeQuery, activeResult.page) === refreshQuery
            ? { source: result, query: activeQuery, result: nextResult }
            : current;
        });
      }
    } catch {
      // Refresh is best-effort and must not interrupt the form UI.
    } finally {
      if (activeRefresh.current === controller) {
        activeRefresh.current = null;
        setShowRefreshing(false);
      }
    }
  }, [query, refreshEndpoint, refreshQuery, result]);

  useEffect(() => {
    const handlePopState = () => {
      void updateOrders(queryFromSearchParams(new URLSearchParams(window.location.search)), undefined, "none");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [updateOrders]);

  useEffect(() => () => {
    activeNavigation.current?.abort();
    activeRefresh.current?.abort();
    if (indicatorTimer.current !== null) window.clearTimeout(indicatorTimer.current);
  }, []);

  useEffect(() => {
    function updateBackToTopVisibility() {
      setShowBackToTop(window.scrollY > MOBILE_BACK_TO_TOP_THRESHOLD);
    }

    updateBackToTopVisibility();
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateBackToTopVisibility);
  }, []);

  return (
    <section className={styles.workbench}>
      <h1 className={styles.visuallyHidden}>Order system data list</h1>
      <div className={styles.listToolbar}>
        <form
          className={styles.quickSearch}
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void updateOrders(parseFormWorkbenchQuery({ q: String(values.get("q") ?? "") }), 1);
          }}
        >
          <label>
            <span className={styles.visuallyHidden}>Search Ref No. / Cust.Name</span>
            <LuSearch className={styles.quickSearchIcon} aria-hidden="true" />
            <input
              aria-label="Search Ref No. / Cust.Name"
              defaultValue={currentQuery.query}
              key={currentQuery.query}
              name="q"
              placeholder="Search name / order no."
              type="search"
            />
          </label>
          <button type="submit" aria-label="Search orders"><span className={styles.quickSearchButtonText}>Search</span><LuChevronRight className={styles.quickSearchButtonIcon} aria-hidden="true" /></button>
        </form>
        <FormsFilterBuilder
          conditions={currentQuery.conditions}
          match={currentQuery.match}
          canViewFinance={canViewFinance}
          canViewCustomerContact={canViewCustomerContact}
          canViewPaymentProof={canViewPaymentProof}
          people={filterPeople}
          customFields={filterCustomFields}
          preset={currentQuery.preset}
          onPresetChange={(preset) => {
            void updateOrders({ ...currentQuery, preset }, 1);
          }}
          renderSavedSearches={canManageViews ? (group, closeFilters, loadSavedSearch) => <FormsSavedViews
            views={savedViews}
            currentQuery={group ? queryString({ ...currentQuery, query: "", pageSize: 100, match: group.match, conditions: group.conditions }) : ""}
            onOpen={(savedQuery) => {
              closeFilters();
              void updateOrders(queryFromSearchParams(new URLSearchParams(savedQuery)), 1);
            }}
            onEdit={loadSavedSearch}
            onChanged={() => router.refresh()}
          /> : undefined}
          onApply={applyFilters}
        />
        <span className={styles.toolbarSpacer} />
        <button
          type="button"
          className={styles.listRefreshButton}
          aria-label="Refresh orders"
          disabled={showRefreshing}
          onClick={() => void refreshOrders()}
        >
          {showRefreshing ? "Refreshing…" : "Refresh"}
        </button>
        {showUpdating ? <span className={styles.listUpdateStatus} role="status" aria-label="Order list update status">Updating…</span> : null}
      </div>

      {updateError ? <div className={styles.listUpdateError} role="alert">
        <span>{updateError}</span>
        {retryTarget ? <button type="button" onClick={() => void updateOrders(retryTarget.query, retryTarget.page)}>Retry order update</button> : null}
      </div> : null}

      <div className={styles.listBody} role="region" aria-label="Order results">
        {currentResult.items.length ? (
          <>
            <FormsOrderTable
              rows={currentResult.items}
              startIndex={(currentResult.page - 1) * currentResult.pageSize}
              canViewFinance={canViewFinance}
              canUpdate={canUpdate}
              canUpdateFinance={canUpdateFinance}
              canUpdateProductionStatus={canUpdateProductionStatus}
              canUpdateDeliveryStatus={canUpdateDeliveryStatus}
              assignees={assignees}
              onOpen={open}
              onSaved={() => void refreshOrders()}
            />
            <FormsOrderCards rows={currentResult.items} startIndex={(currentResult.page - 1) * currentResult.pageSize} canViewFinance={canViewFinance} onOpen={open} />
          </>
        ) : (
          <div className={styles.formsEmptyState}>
            <h1>No orders match these filters.</h1>
            <p>Clear the current search or filters to return to the full data list.</p>
            <Link href="/order-system" onClick={(event) => {
              event.preventDefault();
              void updateOrders(parseFormWorkbenchQuery({}), 1);
            }}>Clear filters</Link>
          </div>
        )}

        {showColumnStats ? <section className={styles.columnStatsPanel} aria-label="Visible column statistics">
          <header><strong>Visible rows</strong><span>Current page only · use Custom stats for all matching orders</span></header>
          <dl>
            <div><dt>Displayed</dt><dd>{currentResult.items.length}</dd></div>
            <div><dt>Urgent</dt><dd>{visibleStats.urgent}</dd></div>
            <div><dt>Completed</dt><dd>{visibleStats.completed}</dd></div>
            <div><dt>Post</dt><dd>{visibleStats.post}</dd></div>
            <div><dt>Pickup</dt><dd>{visibleStats.pickup}</dd></div>
            {canViewFinance ? <><div><dt>Amount payable</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.payable / 100)}</dd></div><div><dt>Amount paid</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.paid / 100)}</dd></div><div><dt>Amount owing</dt><dd>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(visibleStats.owing / 100)}</dd></div></> : null}
          </dl>
        </section> : null}
      </div>

      <footer className={styles.listFooter}>
        <strong>{currentResult.total} {currentResult.total === 1 ? "order" : "orders"}</strong>
        <button type="button" onClick={() => setShowColumnStats((visible) => !visible)}>Column stats</button>
        {showColumnStats ? <span className={styles.columnStatsSummary}>Showing {currentResult.items.length} of {currentResult.total}</span> : null}
        <nav aria-label="Order pages">
          {currentResult.page > 1 ? <Link href={orderListUrl(currentQuery, currentResult.page - 1)} onClick={(event) => {
            event.preventDefault();
            void updateOrders(currentQuery, currentResult.page - 1);
          }}>Previous</Link> : <span />}
          <span>{currentResult.pageCount ? `${currentResult.page} / ${currentResult.pageCount}` : "0 / 0"}</span>
          {currentResult.page < currentResult.pageCount ? <Link href={orderListUrl(currentQuery, currentResult.page + 1)} onClick={(event) => {
            event.preventDefault();
            void updateOrders(currentQuery, currentResult.page + 1);
          }}>Next</Link> : <span />}
        </nav>
        <div className={styles.perPageControl}>
          <label>
            <span className={styles.visuallyHidden}>Orders per page</span>
            <select
              aria-label="Orders per page"
              value={String(currentQuery.pageSize)}
              name="perPage"
              onChange={(event) => {
                const pageSize = Number(event.target.value) as FormWorkbenchQuery["pageSize"];
                void updateOrders({ ...currentQuery, pageSize }, 1);
              }}
            >
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
          </label>
        </div>
      </footer>
      {showBackToTop ? (
        <button
          className={styles.mobileBackToTop}
          type="button"
          aria-label="Back to top"
          onClick={() => {
            window.scrollTo({ top: 0, left: 0, behavior: "auto" });
            setShowBackToTop(false);
          }}
        >
          <LuArrowUp aria-hidden="true" />
        </button>
      ) : null}
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
        onSaved={() => void refreshOrders()}
      /> : null}
      {orderEntry ? <FormsOrderEntryDrawer data={orderEntry} onClose={closeOrderEntry} /> : null}
    </section>
  );
}
