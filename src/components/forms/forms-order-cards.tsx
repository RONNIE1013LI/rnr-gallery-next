"use client";

import type { FormOrderRow } from "@/server/forms/forms-workbench-service";
import { formsLabel, formsMoney } from "./forms-format";
import styles from "./forms.module.css";

export function FormsOrderCards({
  rows,
  canViewFinance,
  onOpen,
}: Readonly<{
  rows: readonly FormOrderRow[];
  canViewFinance: boolean;
  onOpen: (jobId: string) => void;
}>) {
  return (
    <div className={styles.orderCards} aria-label="Mobile orders data list">
      {rows.map((row) => (
        <article className={styles.orderCard} key={row.id} data-urgent={row.urgent}>
          <header>
            <div>
              <button type="button" onClick={() => onOpen(row.id)} aria-label={`Open order ${row.reference}`}>{row.reference}</button>
              <strong>{row.customerName}</strong>
            </div>
            <span>{row.urgent ? "Urgent" : "Normal"}</span>
          </header>
          <dl>
            <div><dt>Size</dt><dd>{row.size || "—"}</dd></div>
            <div><dt>Delivery</dt><dd>{formsLabel(row.deliveryMethod)}</dd></div>
            <div><dt>Needed</dt><dd>{row.neededDate}</dd></div>
            <div><dt>Status</dt><dd>{formsLabel(row.status)}</dd></div>
            <div><dt>Artist</dt><dd>{row.artistName}</dd></div>
            {canViewFinance && row.finance ? <div><dt>Balance</dt><dd>{formsMoney.format(row.finance.amountOwingCents / 100)} owing</dd></div> : null}
          </dl>
        </article>
      ))}
    </div>
  );
}
