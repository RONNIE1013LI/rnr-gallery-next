"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  ExplorerConversion, ExplorerMoney, ExplorerQuality, ExplorerSessionsResponse,
  ExplorerVisitorResponse,
} from "@/domain/analytics/website-analytics-explorer";
import { formatAnalyticsMoney } from "./website-analytics-v2-charts";
import adminStyles from "./admin.module.css";
import styles from "./website-analytics-v2.module.css";

export const explorerFilterKeys = ["path", "channel", "source", "medium", "campaign", "q"] as const;
export const explorerQueryKeys = [...explorerFilterKeys, "trafficSort", "trafficPage", "trafficPageSize", "visitor", "session"] as const;

export function analyticsExplorerQuery(query: string, values: Readonly<Record<string, string | number | null>>) {
  const result = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "" || (key === "trafficPage" && Number(value) === 1)) result.delete(key);
    else result.set(key, String(value));
  }
  return result.toString();
}

export function analyticsOverviewQuery(query: string) {
  const result = new URLSearchParams(query);
  for (const key of explorerQueryKeys) result.delete(key);
  result.sort();
  return result.toString();
}

const dateTime = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland", year: "numeric", month: "short", day: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const number = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-NZ", { style: "percent", maximumFractionDigits: 1 });
const shortId = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
const known = (value: string | null) => value || "Not recorded";
const flag = (value: boolean | null) => value === null ? "Not recorded" : value ? "Yes" : "No";
const duration = (seconds: number | null) => seconds === null ? "Not available" : `${number.format(seconds)} s`;
const channelLabel = (value: string) => value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

function useAnalyticsRead<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Analytics read failed");
        const data = await response.json() as T;
        if (!controller.signal.aborted) setResult({ key, data, error: false });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ key, data: null, error: true });
      });
    return () => controller.abort();
  }, [key, url]);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.key === key && result.error,
    loading: result?.key !== key,
    retry: () => setAttempt((value) => value + 1),
  };
}

function Money({ money }: Readonly<{ money: readonly ExplorerMoney[] }>) {
  if (money.length === 0) return <>—</>;
  return <>{money.map((entry) => <span className={styles.cellLine} key={entry.currency}>
    {formatAnalyticsMoney(entry.currency, entry.netCollectedRevenueCents)}
  </span>)}</>;
}

function Quality({ summary }: Readonly<{ summary: ExplorerQuality }>) {
  const metrics = [
    ["Visitors", summary.visitors], ["Sessions", summary.sessions], ["Pageviews", summary.pageViews],
    ["Pages / session (in range)", summary.pagesPerSession === null ? "Not available" : number.format(summary.pagesPerSession)],
    ["Single-page sessions", summary.singlePageSessions], ["Multi-page sessions", summary.multiPageSessions],
    ["Single-page session rate", summary.singlePageRate === null ? "Not available" : percent.format(summary.singlePageRate)],
    ["Avg observed span", duration(summary.avgObservedDurationSeconds)],
    ["New in retained history", summary.observedNewVisitors], ["Returning in retained history", summary.observedReturningVisitors],
  ] as const;
  const steps = [
    ["Sessions", summary.sessions], ["Product", summary.productSessions], ["Cart", summary.cartSessions],
    ["Checkout", summary.checkoutSessions], ["Order", summary.orderSessions], ["Paid", summary.paidSessions],
  ] as const;
  return <>
    <dl className={styles.qualityGrid} aria-label="Session quality">
      {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <div className={styles.chartTableScroller} role="region" tabIndex={0} aria-label="Session journey stages">
      <table className={styles.dataTable} aria-label="Session journey stages"><thead><tr>
        {steps.map(([label]) => <th key={label} scope="col">{label}</th>)}
      </tr></thead><tbody><tr>{steps.map(([label, count]) => <td key={label}>{count ?? "Not recorded"}</td>)}</tr></tbody></table>
    </div>
    <p className={styles.muted}>Distinct sessions reaching each stage; stages may be skipped. These are reach counts, not an ordered funnel. Observed span is the time between recorded pageviews, not time actively engaged. A single-page session has no measured duration.</p>
  </>;
}

function Conversion({ order }: Readonly<{ order: ExplorerConversion }>) {
  const touches = [
    ["First touch", order.orderAcquisition.firstTouch], ["Last session touch", order.orderAcquisition.lastTouch],
    ["Last non-direct touch", order.orderAcquisition.lastNonDirectTouch],
  ] as const;
  return <div className={styles.conversionCard}>
    <h4>{order.adminHref ? <Link href={order.adminHref}>Order {order.orderNumber}</Link> : `Order ${order.orderNumber}`}</h4>
    <p>{formatAnalyticsMoney(order.currency, order.orderedAmountCents)} · {order.paymentStatus}
      {order.paidAt ? ` · Paid ${dateTime.format(new Date(order.paidAt))}` : ""}</p>
    <p>Credited attribution ({order.attribution.model === "first_touch" ? "First touch" : "Last non-direct touch"}): {channelLabel(order.attribution.channel)} · {known(order.attribution.source)} / {known(order.attribution.medium)} · {known(order.attribution.campaign)}</p>
    <dl className={styles.detailFacts}>
      {touches.map(([label, touch]) => <div key={label}><dt>{label}</dt><dd>{touch
        ? <>{known(touch.source)} / {known(touch.medium)} · {known(touch.campaign)}<br />{dateTime.format(new Date(touch.at))} · {touch.landingPath}<br />Referrer: {known(touch.referrerOrigin)}</>
        : "Not available for this order"}</dd></div>)}
      <div><dt>Click ID Type / Click ID</dt><dd>{order.orderAcquisition.clickIds.length > 0
        ? order.orderAcquisition.clickIds.map((click) => <div key={`${click.type}:${click.value}`}><strong>{click.type}</strong><code className={styles.fullIdentifier}>{click.value}</code></div>)
        : "Not available for this order"}</dd></div>
    </dl>
  </div>;
}

function VisitorDetail({ visitorId, sessionId, canonicalQuery, onClose }: Readonly<{
  visitorId: string; sessionId: string | null; canonicalQuery: string; onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams(canonicalQuery);
  for (const key of [...explorerFilterKeys, "visitor", "sort", "page", "pageSize"]) params.delete(key);
  params.set("trafficPage", String(page));
  params.set("trafficPageSize", "25");
  params.set("trafficSort", "started_at_desc");
  if (sessionId) params.set("session", sessionId); else params.delete("session");
  const { data, error, loading, retry } = useAnalyticsRead<ExplorerVisitorResponse>(
    `/api/admin/analytics/visitors/${encodeURIComponent(visitorId)}?${params}`,
  );
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="visitor-journey-title"
    className={styles.visitorDialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, select, summary, [tabindex='0']");
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <header className={styles.detailHeader}><div><h2 id="visitor-journey-title">Visitor journey</h2>
      <p>All retained activity · Pacific/Auckland</p></div>
      <button ref={closeRef} type="button" className={styles.detailClose} onClick={onClose}>Close</button></header>
    <div className={styles.detailBody} aria-busy={loading}>
      {loading ? <p role="status">Loading visitor journey…</p> : null}
      {error ? <div role="alert"><p>Visitor journey could not be loaded.</p><button type="button" className={styles.textButton} onClick={retry}>Retry journey</button></div> : null}
      {data ? <>
        <dl className={styles.detailFacts}>
          <div><dt>Anonymous visitor ID</dt><dd><code className={styles.fullIdentifier}>{visitorId}</code></dd></div>
          <div><dt>First / last seen in retained history</dt><dd>{data.visitor
            ? <>{dateTime.format(new Date(data.visitor.firstSeenAt))}<br />{dateTime.format(new Date(data.visitor.lastSeenAt))}</>
            : "Not available for this visitor"}</dd></div>
          <div><dt>Visits in retained history</dt><dd>{data.visitor ? `${data.visitor.sessionCount} sessions · ${data.visitor.observedReturning ? "Returning" : "New"}` : "Not available"}</dd></div>
          <div><dt>Device / browser / OS / city</dt><dd>Not collected</dd></div>
        </dl>
        {data.notices.length > 0 ? <details className={styles.acquisitionDetails}>
          <summary>Data coverage and measurement notes</summary>
          {data.notices.map((notice) => <p key={notice} className={styles.muted}>{notice}</p>)}
        </details> : null}
        {data.sessions.length === 0 ? <p>No retained sessions are available for this visitor.</p> : null}
        {data.sessions.map((session) => {
          const timeline: { id: string; at: string; content: ReactNode }[] = [
            ...session.pageviews.map((view) => ({ id: `page:${view.id}`, at: view.occurredAt, content: <code>{view.pathname}</code> })),
            ...session.conversions.map((order) => ({ id: `order:${order.conversionId}`, at: order.occurredAt,
              content: order.adminHref ? <Link href={order.adminHref}>Order {order.orderNumber} created</Link> : <>Order {order.orderNumber} created</> })),
            ...session.financialEvents.map((event) => ({ id: `payment:${event.id}`, at: event.occurredAt,
              content: <>{event.type === "receipt" ? "Payment received" : event.type === "refund" ? "Refund" : "Payment reversal"} · {formatAnalyticsMoney(event.currency, event.amountCents)}</> })),
          ].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
          return <section key={session.sessionId} className={styles.sessionDetail}>
            <h3>Session <code className={styles.fullIdentifier}>{session.sessionId}</code></h3>
            <dl className={styles.detailFacts}>
              <div><dt>Start / last activity</dt><dd>{dateTime.format(new Date(session.startedAt))}<br />{dateTime.format(new Date(session.lastSeenAt))}</dd></div>
              <div><dt>Country</dt><dd>{known(session.countryCode)}</dd></div>
              <div><dt>Session acquisition</dt><dd>{channelLabel(session.channel)} · {known(session.source)} / {known(session.medium)}<br />Campaign: {known(session.campaign)}</dd></div>
              <div><dt>Landing / exit</dt><dd>{known(session.entryPage)}<br />{known(session.exitPage)}</dd></div>
              <div><dt>Pageviews / observed span</dt><dd>{session.pageViews} · {duration(session.observedDurationSeconds)}{session.singlePage ? " · Single-page session" : ""}</dd></div>
              <div><dt>Cart / Checkout</dt><dd>{flag(session.cart)} / {flag(session.checkout)}</dd></div>
              <div><dt>Click ID Type</dt><dd>{known(session.clickIdType)}</dd></div>
              <div><dt>Click ID / referrer</dt><dd>Available below only when captured with a linked order.</dd></div>
            </dl>
            <ol className={styles.journeyTimeline} aria-label="Session journey">{timeline.map((event) => <li key={event.id}>
              <time dateTime={event.at}>{dateTime.format(new Date(event.at))}</time><div>{event.content}</div>
            </li>)}</ol>
            {session.pageviews.length === 0 ? <p>No retained pageviews for this session.</p> : null}
            {session.pageviewsTruncated ? <p className={styles.muted}>Showing {session.pageviews.length} of {session.pageviewsTotal} retained pageviews. This journey is incomplete.</p> : null}
            {session.conversions.length === 0 ? <p className={styles.muted}>No linked order was recorded for this session.</p>
              : session.conversions.map((order) => <Conversion key={order.conversionId} order={order} />)}
          </section>;
        })}
        {data.pageCount > 1 ? <nav className={styles.pagination} aria-label="Visitor sessions pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous visits</button>
          <span>Page {page} of {data.pageCount}</span>
          <button type="button" disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Next visits</button>
        </nav> : null}
        {data.truncated ? <p className={styles.muted}>Only the listed sessions are included on this page.</p> : null}
      </> : null}
    </div>
  </dialog>;
}

export function WebsiteAnalyticsV2Explorer({ canonicalQuery, onNavigate }: Readonly<{
  canonicalQuery: string; onNavigate: (query: string) => void;
}>) {
  const sectionRef = useRef<HTMLElement>(null);
  const returnFocusLabelRef = useRef<string | null>(null);
  const params = new URLSearchParams(canonicalQuery);
  const appliedSearch = params.get("q") ?? "";
  const [search, setSearch] = useState(appliedSearch);
  const [previousSearch, setPreviousSearch] = useState(appliedSearch);
  if (appliedSearch !== previousSearch) { setPreviousSearch(appliedSearch); setSearch(appliedSearch); }
  const visitor = params.get("visitor");
  const session = params.get("session");
  // A server navigation may replace the original trigger after the dialog closes.
  useEffect(() => {
    if (visitor) {
      returnFocusLabelRef.current = session ? `View session ${session}` : `View visitor ${visitor}`;
      return;
    }
    const label = returnFocusLabelRef.current;
    if (!label) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== document.documentElement) {
      if (focused.getAttribute("aria-label") !== label) returnFocusLabelRef.current = null;
      return;
    }
    const trigger = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])]
      .find((button) => button.getAttribute("aria-label") === label);
    trigger?.focus({ preventScroll: true });
  });
  const listParams = new URLSearchParams(canonicalQuery);
  for (const key of ["visitor", "session", "sort", "page", "pageSize"]) listParams.delete(key);
  const { data, loading, error, retry } = useAnalyticsRead<ExplorerSessionsResponse>(`/api/admin/analytics/sessions?${listParams}`);
  const rangeEnd = params.get("to");
  const coveredRange = Boolean(data?.metadata.coverageFrom
    && (!rangeEnd || rangeEnd >= data.metadata.coverageFrom));
  const change = (values: Readonly<Record<string, string | number | null>>) => onNavigate(analyticsExplorerQuery(canonicalQuery, values));
  const open = (visitorId: string, sessionId: string | null) => change({ visitor: visitorId, session: sessionId });
  return <section ref={sectionRef} className={`${adminStyles.panel} ${styles.explorerPanel}`} id="analytics-sessions" aria-label="Visitors and sessions" aria-busy={loading}>
    <div className={styles.sectionHeading}><h2>Visitors / Sessions</h2><span>Anonymous first-party activity</span></div>
    <p className={styles.muted}>Consent-qualified website sessions, grouped by their arrival source. Orders and revenue here belong to the converting session; credited channel attribution is shown separately in each order detail. Website sessions and advertising-platform clicks are different measures.</p>
    <form className={styles.explorerControls} onSubmit={(event) => { event.preventDefault(); change({ q: search.trim(), trafficPage: 1, visitor: null, session: null }); }}>
      <label className={styles.sessionSearch}>Search visitors or sessions<input aria-label="Search visitors or sessions" type="search" value={search} maxLength={200}
        placeholder="Visitor, session, order, campaign or click ID" onChange={(event) => setSearch(event.target.value)} /></label>
      <button type="submit">Search sessions</button>
      <label>Sort sessions<select value={params.get("trafficSort") ?? "started_at_desc"} onChange={(event) => change({ trafficSort: event.target.value, trafficPage: 1 })}>
        <option value="started_at_desc">Newest first</option><option value="started_at_asc">Oldest first</option>
        <option value="pageviews_desc">Most pageviews</option><option value="duration_desc">Longest observed span</option>
      </select></label>
      <label>Sessions per page<select value={params.get("trafficPageSize") ?? "25"} onChange={(event) => change({ trafficPageSize: event.target.value, trafficPage: 1 })}>
        {[...new Set([10, 25, 50, 100, Number(params.get("trafficPageSize") ?? 25)])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
      </select></label>
    </form>
    <div className={styles.filterChips} aria-label="Session filters">
      {explorerFilterKeys.filter((key) => params.has(key)).map((key) => <button key={key} type="button"
        onClick={() => change({ [key]: null, trafficPage: 1, visitor: null, session: null })}>{key}: {params.get(key)} <span aria-hidden="true">×</span><span className={styles.srOnly}> Remove filter</span></button>)}
      <button type="button" className={styles.textButton} onClick={() => change({ path: "/cart", trafficPage: 1, visitor: null, session: null })}>Cart visitors</button>
    </div>
    {loading ? <p role="status">Loading sessions…</p> : null}
    {error ? <div role="alert" className={styles.error}><p>Sessions could not be loaded.</p><button type="button" className={styles.textButton} onClick={retry}>Retry sessions</button></div> : null}
    {data ? <>
      {!data.metadata.completeRange ? <p className={styles.muted}>{coveredRange ? "Partial retained traffic coverage" : "No retained traffic coverage for this range"}{data.metadata.coverageFrom ? `; retained data starts ${data.metadata.coverageFrom}` : ""}. Historical visitors and journeys outside retention are not available.</p> : null}
      {data.notices.length > 0 ? <details className={styles.acquisitionDetails}>
        <summary>Data coverage and measurement notes</summary>
        {data.notices.map((notice) => <p className={styles.muted} key={notice}>{notice}</p>)}
      </details> : null}
      {!coveredRange ? <p className={styles.muted}>Session metrics and journeys are not available for this date range.</p> : <>
      {!data.metadata.completeRange ? <p className={styles.muted}>Counts below describe the retained sample only.</p> : null}
      <Quality summary={data.summary} />
      {data.acquisition.length > 0 ? <details className={styles.acquisitionDetails}><summary>Source / campaign visit quality</summary>
        <div className={styles.chartTableScroller} role="region" tabIndex={0} aria-label="Acquisition session quality">
          <table className={styles.dataTable}><thead><tr><th>Channel</th><th>Source / Medium</th><th>Campaign</th><th>Visitors</th><th>Sessions</th><th>Pages / session</th><th>Single-page</th><th>Product</th><th>Cart</th><th>Checkout</th><th>Orders</th><th>Paid</th><th>Net collected</th></tr></thead>
            <tbody>{data.acquisition.map((row) => <tr key={JSON.stringify([row.channel, row.source, row.medium, row.campaign])}>
              <th scope="row"><button type="button" className={styles.textButton} onClick={() => change({ channel: row.channel, source: null, medium: null, campaign: null, trafficPage: 1 })}>{channelLabel(row.channel)}</button></th>
              <td><button type="button" className={styles.textButton} onClick={() => change({ channel: row.channel, source: row.source ?? "(not set)", medium: row.medium ?? "(not set)", campaign: null, trafficPage: 1 })}>{known(row.source)} / {known(row.medium)}</button></td>
              <td><button type="button" className={styles.textButton} onClick={() => change({ channel: row.channel, source: row.source ?? "(not set)", medium: row.medium ?? "(not set)", campaign: row.campaign ?? "(not set)", trafficPage: 1 })}>{known(row.campaign)}</button></td>
              <td>{row.visitors}</td><td>{row.sessions}</td><td>{row.pagesPerSession === null ? "—" : number.format(row.pagesPerSession)}</td><td>{row.singlePageSessions}</td><td>{row.productSessions}</td><td>{row.cartSessions}</td><td>{row.checkoutSessions ?? "Not recorded"}</td><td>{row.orders}</td><td>{row.paidOrders}</td><td><Money money={row.money} /></td>
            </tr>)}</tbody></table>
        </div></details> : null}
      {data.items.length === 0 ? <p className={styles.muted}>No retained sessions match these filters.</p>
        : <div className={styles.orderTableScroller} role="region" tabIndex={0} aria-label="Visitor sessions table">
          <table className={`${styles.dataTable} ${styles.sessionTable}`} aria-label="Visitor sessions"><thead><tr>
            <th>Time (NZ)</th><th>Visitor / Session</th><th>Country</th><th>Channel</th><th>Source / Medium</th><th>Campaign</th><th>Landing / Exit</th><th>Pageviews in range</th><th>Observed span</th><th>Cart</th><th>Checkout</th><th>Orders / Paid</th><th>Net collected</th>{params.has("path") ? <th>Page neighbors</th> : null}
          </tr></thead><tbody>{data.items.map((row) => <tr key={row.sessionId}>
            <td><time dateTime={row.startedAt}>{dateTime.format(new Date(row.startedAt))}</time></td>
            <th scope="row"><button type="button" aria-label={`View visitor ${row.visitorId}`} className={styles.textButton} onClick={(event) => { event.currentTarget.focus(); open(row.visitorId, null); }}>{shortId(row.visitorId)}</button>
              <button type="button" aria-label={`View session ${row.sessionId}`} className={`${styles.textButton} ${styles.cellLine}`} onClick={(event) => { event.currentTarget.focus(); open(row.visitorId, row.sessionId); }}>{shortId(row.sessionId)}</button></th>
            <td>{known(row.countryCode)}</td><td>{channelLabel(row.channel)}</td><td>{known(row.source)} / {known(row.medium)}</td><td>{known(row.campaign)}</td>
            <td>{known(row.entryPage)}<small className={styles.cellLine}>Exit: {known(row.exitPage)}</small></td><td>{row.pageViews}{row.pageViews !== row.sessionPageViews ? <small className={styles.cellLine}>{row.sessionPageViews} retained in session</small> : null}{row.singlePage ? <small className={styles.cellLine}>Single-page session</small> : null}</td>
            <td>{duration(row.observedDurationSeconds)}</td><td>{flag(row.cart)}</td><td>{flag(row.checkout)}</td><td>{row.orders} / {row.paidOrders}</td><td><Money money={row.money} /></td>
            {params.has("path") ? <td>{row.matchedPage ? <><span className={styles.cellLine}>Previous: {row.matchedPage.previousPage ?? "No recorded previous page"}</span><span className={styles.cellLine}>Next: {row.matchedPage.nextPage ?? "No recorded next page"}</span></> : "Not available"}</td> : null}
          </tr>)}</tbody></table></div>}
      <nav className={styles.pagination} aria-label="Sessions pagination"><button type="button" aria-label="Previous sessions page" disabled={data.page <= 1 || data.pageCount === 0} onClick={() => change({ trafficPage: data.page - 1 })}>Previous</button>
        <span>Page {data.pageCount === 0 ? 0 : data.page} of {data.pageCount} · {data.total} sessions</span><button type="button" aria-label="Next sessions page" disabled={data.page >= data.pageCount} onClick={() => change({ trafficPage: data.page + 1 })}>Next</button></nav>
      </>}
    </> : null}
    {visitor ? <VisitorDetail key={`${visitor}:${session ?? "all"}`} visitorId={visitor} sessionId={session} canonicalQuery={canonicalQuery} onClose={() => change({ visitor: null, session: null })} /> : null}
  </section>;
}
