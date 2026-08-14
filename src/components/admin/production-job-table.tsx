import Link from "next/link";
import type { ProductionJobListItem } from "@/server/production/drizzle-production-job-repository";
import styles from "./admin.module.css";

const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeZone: "Pacific/Auckland" });

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProductionJobTable({ jobs, canViewFinance }: Readonly<{
  jobs: readonly ProductionJobListItem[];
  canViewFinance: boolean;
}>) {
  if (!jobs.length) {
    return (
      <div className={styles.emptyState}>
        <h2>No production jobs match these filters.</h2>
        <p>Clear the filters or search for a different job.</p>
        <Link href="/admin/jobs">Clear filters</Link>
      </div>
    );
  }
  return (
    <div className={styles.tableScroll} tabIndex={0} aria-label="Production jobs table">
      <table className={styles.dataTable}>
        <thead><tr>
          <th>Job</th><th>Customer</th><th>Product</th><th>Workflow</th><th>Needed</th><th>Assigned</th>
          {canViewFinance ? <th>Payable</th> : null}
          <th><span className={styles.visuallyHidden}>Action</span></th>
        </tr></thead>
        <tbody>{jobs.map((job) => (
          <tr key={job.id}>
            <td><strong>{job.jobNumber}</strong><small>{job.source === "web" ? "Online order" : `Manual · ${label(job.customerSource)}`}</small>{job.urgent ? <span className={styles.urgentBadge}>Urgent</span> : null}</td>
            <td><strong>{job.customerName}</strong><small>{job.customerEmail || job.customerPhone}</small></td>
            <td>{job.productTitles.map((title, index) => <span key={`${title}-${index}`}>{title}<small>{job.sizeLabels[index] ?? ""}</small></span>)}</td>
            <td><span className={styles.statusBadge}>{label(job.status)}</span><small>{label(job.paymentStatus)}</small></td>
            <td className={styles.numeric}><strong>{date.format(new Date(`${job.neededDate}T12:00:00+12:00`))}</strong><small>{label(job.deliveryMethod)}</small></td>
            <td>{job.assignedUserName ?? "Unassigned"}</td>
            {canViewFinance ? <td className={styles.numeric}>{job.finance ? money.format(job.finance.amountPayableCents / 100) : "—"}<small>{job.finance?.amountOwingCents ? `${money.format(job.finance.amountOwingCents / 100)} owing` : "No balance"}</small></td> : null}
            <td><Link className={styles.tableAction} href={`/admin/jobs/${job.id}`} aria-label={`Open ${job.jobNumber}`}>Open</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
