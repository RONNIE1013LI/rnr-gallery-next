"use client";

import type { FormOrderRow } from "@/server/forms/forms-workbench-service";
import { formsLabel } from "./forms-format";
import styles from "./forms.module.css";

const submittedAtFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function amount(cents: number) {
  return (cents / 100).toFixed(2);
}

export function FormsOrderCards({
  rows,
  startIndex,
  canViewFinance,
  onOpen,
}: Readonly<{
  rows: readonly FormOrderRow[];
  startIndex: number;
  canViewFinance: boolean;
  onOpen: (jobId: string) => void;
}>) {
  return (
    <div className={styles.orderCards} aria-label="Mobile orders data list">
      {rows.map((row, index) => (
        <article className={styles.orderCard} key={row.id} data-urgent={row.urgent}>
          <header>
            <button type="button" title={row.reference} onClick={() => onOpen(row.id)} aria-label={`Open order ${row.reference}`}>{row.reference}</button>
            <time dateTime={row.submittedAt}>{submittedAtFormat.format(new Date(row.submittedAt))}</time>
            <span>#{startIndex + index + 1}</span>
          </header>
          <dl>
            <div><dt>Cust.Name</dt><dd>{row.customerName || "—"}</dd></div>
            <div><dt>Size</dt><dd>{row.size || "—"}</dd></div>
            {canViewFinance && row.finance ? <>
              <div><dt>AmtOwe</dt><dd data-align="right">{amount(row.finance.amountOwingCents)}</dd></div>
              <div><dt>AmtPayable</dt><dd>{amount(row.finance.amountPayableCents)}</dd></div>
            </> : null}
            <div><dt>DlvryMethod</dt><dd data-field="deliveryMethod" data-status={row.deliveryMethod}>{formsLabel(row.deliveryMethod)}</dd></div>
            <div><dt>Delivered</dt><dd data-field="delivered" data-status={row.milestones.delivered ? "yes" : "no"}>{row.milestones.delivered ? "YES" : "NO"}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}
