"use client";

import { visibleFormColumns, type FormOrderRow } from "@/server/forms/forms-workbench-service";
import type { FormInlineFieldKey } from "@/domain/forms/forms-parity";
import {
  formsLabel,
  formsMoney,
  formsStatusKey,
  formsSubmittedAt,
  milestoneValue,
} from "./forms-format";
import styles from "./forms.module.css";
import { FormsInlineCell } from "./forms-inline-cell";

type Assignee = Readonly<{ id: string; name: string }>;
type EditAccess = Readonly<{
  canUpdate: boolean;
  canUpdateFinance: boolean;
  canUpdateProductionStatus: boolean;
  canUpdateDeliveryStatus: boolean;
  assignees: readonly Assignee[];
  onSaved: () => void;
}>;

const deliveryOptions = [
  ["post", "Post"], ["pickup", "Pick up"], ["delivery", "Delivery"],
  ["email", "Email"], ["courier", "Courier"],
  ["australia_shipping", "Australia Shipping"], ["other", "Other"],
].map(([value, label]) => ({ value, label }));
const sourceOptions = [
  ["rnr", "R&R"], ["web", "Web"], ["market", "Market"], ["email", "Email"],
  ["instagram", "IG"], ["tiktok", "TikTok"], ["whatsapp", "Whatsapp"],
  ["wechat", "WeChat"], ["phone", "Phone"], ["messenger", "Messenger"],
  ["walk_in", "Walk in"], ["other", "Other"],
].map(([value, label]) => ({ value, label }));
const bankOptions = ["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"]
  .map((value) => ({ value, label: value }));
const deliveredOptions = [
  { value: "no", label: "NO" },
  { value: "yes", label: "YES" },
  { value: "hold", label: "HOLD" },
];

function StatusValue({ field, value }: Readonly<{ field: string; value: string }>) {
  return <span className={styles.statusValue} data-field={field} data-status={formsStatusKey(value)}>{value}</span>;
}

function CellDisplay({
  row,
  column,
  onOpen,
}: Readonly<{
  row: FormOrderRow;
  column: string;
  onOpen: (jobId: string) => void;
}>) {
  if (column === "submittedAt") return formsSubmittedAt(row.submittedAt);
  if (column === "reference") {
    return <button className={styles.referenceButton} onClick={() => onOpen(row.id)} type="button" aria-label={`Open order ${row.reference}`}>{row.reference}</button>;
  }
  if (column === "webOrderNumber") return row.webOrderNumber || "—";
  if (column === "size") return row.size || "—";
  if (column === "urgent") return <StatusValue field={column} value={row.urgent ? "Urgent" : "Normal"} />;
  if (column === "neededDate") return row.neededDate;
  if (column === "deliveryMethod") return <StatusValue field={column} value={formsLabel(row.deliveryMethod)} />;
  if (column === "customerSource") return <StatusValue field={column} value={formsLabel(row.customerSource)} />;
  if (column === "customerName") return row.customerName;
  if (column === "assignArtist") return <StatusValue field={column} value={row.assignedUserId ? "YES" : "NO"} />;
  if (column === "artist") return row.artistName;
  if (column === "fileSent") return <StatusValue field={column} value={milestoneValue(row, "fileSent")} />;
  if (column === "downloaded") return <StatusValue field={column} value={milestoneValue(row, "downloaded")} />;
  if (column === "customerNotified") return <StatusValue field={column} value={milestoneValue(row, "customerNotified")} />;
  if (column === "printed") return <StatusValue field={column} value={milestoneValue(row, "printed")} />;
  if (column === "completed") return <StatusValue field={column} value={milestoneValue(row, "completed")} />;
  if (column === "delivered") {
    const value = row.source === "manual" && row.status === "on_hold"
      ? "HOLD"
      : milestoneValue(row, "delivered");
    return <StatusValue field={column} value={value} />;
  }
  if (column === "bankRecon") return row.bankRecon ? <StatusValue field={column} value={row.bankRecon} /> : "—";
  if (column === "amountOwing") return row.finance ? formsMoney.format(row.finance.amountOwingCents / 100) : "—";
  if (column === "amountPaid") return row.finance ? formsMoney.format(row.finance.amountPaidCents / 100) : "—";
  if (column === "amountPayable") return row.finance ? formsMoney.format(row.finance.amountPayableCents / 100) : "—";
  if (column === "artistFee") return row.finance?.artistFeeCents !== null && row.finance ? formsMoney.format(row.finance.artistFeeCents / 100) : "—";
  if (column === "remark") return row.remark || "—";
  if (column === "submittedBy") return row.submittedBy;
  return "—";
}

function inlineDefinition(row: FormOrderRow, column: string, access: EditAccess) {
  if (!access.canUpdate) return null;
  if (column === "urgent") return { field: "urgent", kind: "boolean", value: row.urgent } as const;
  if (column === "neededDate") return { field: "neededDate", kind: "date", value: row.neededDate } as const;
  if (column === "deliveryMethod") return { field: "deliveryMethod", kind: "select", value: row.deliveryMethod, options: deliveryOptions } as const;
  if (column === "customerSource") return { field: "customerSource", kind: "select", value: row.customerSource, options: sourceOptions } as const;
  if (column === "artist") return {
    field: "artist", kind: "select", value: row.assignedUserId ?? "",
    options: [{ value: "", label: "Unassigned" }, ...access.assignees.map((person) => ({ value: person.id, label: person.name }))],
  } as const;
  if (column === "remark") return { field: "remark", kind: "text", value: row.remark } as const;
  if (["fileSent", "downloaded", "customerNotified", "printed", "completed"].includes(column) && access.canUpdateProductionStatus) {
    const field = column as keyof FormOrderRow["milestones"] & FormInlineFieldKey;
    return { field, kind: "boolean", value: row.milestones[field] } as const;
  }
  if (column === "delivered" && access.canUpdateDeliveryStatus) {
    if (row.source === "manual") {
      const value = row.status === "on_hold" ? "hold" : row.milestones.delivered ? "yes" : "no";
      return { field: "delivered", kind: "select", value, options: deliveredOptions } as const;
    }
    return { field: "delivered", kind: "boolean", value: row.milestones.delivered } as const;
  }
  if (access.canUpdateFinance && column === "bankRecon") {
    return { field: "bankRecon", kind: "select", value: row.bankRecon ?? "Not checked", options: bankOptions } as const;
  }
  if (access.canUpdateFinance && row.source === "manual" && row.finance && column === "amountPaid") {
    return { field: "amountPaid", kind: "money", value: row.finance.amountPaidCents } as const;
  }
  if (access.canUpdateFinance && row.source === "manual" && row.finance && column === "amountPayable") {
    return { field: "amountPayable", kind: "money", value: row.finance.amountPayableCents } as const;
  }
  if (access.canUpdateFinance && row.source === "manual" && row.finance && column === "artistFee") {
    return { field: "artistFee", kind: "money", value: row.finance.artistFeeCents ?? 0 } as const;
  }
  return null;
}

function CellValue({
  row,
  column,
  label,
  onOpen,
  editAccess,
}: Readonly<{
  row: FormOrderRow;
  column: string;
  label: string;
  onOpen: (jobId: string) => void;
  editAccess: EditAccess;
}>) {
  const display = <CellDisplay row={row} column={column} onOpen={onOpen} />;
  const definition = inlineDefinition(row, column, editAccess);
  if (!definition) return display;
  return <FormsInlineCell
    jobId={row.id}
    reference={row.reference}
    field={definition.field}
    label={label}
    value={definition.value}
    version={row.version}
    kind={definition.kind}
    options={"options" in definition ? definition.options : undefined}
    onSaved={editAccess.onSaved}
    onReload={editAccess.onSaved}
  >{display}</FormsInlineCell>;
}

export function FormsOrderTable({
  rows,
  canViewFinance,
  canUpdate = false,
  canUpdateFinance = false,
  canUpdateProductionStatus = false,
  canUpdateDeliveryStatus = false,
  assignees = [],
  startIndex = 0,
  onOpen,
  onSaved = () => undefined,
}: Readonly<{
  rows: readonly FormOrderRow[];
  canViewFinance: boolean;
  canUpdate?: boolean;
  canUpdateFinance?: boolean;
  canUpdateProductionStatus?: boolean;
  canUpdateDeliveryStatus?: boolean;
  assignees?: readonly Assignee[];
  startIndex?: number;
  onOpen: (jobId: string) => void;
  onSaved?: () => void;
}>) {
  const columns = visibleFormColumns({ canViewFinance });
  return (
    <div className={styles.tableViewport} tabIndex={0} aria-label="Scrollable orders data list">
      <table className={styles.orderTable} aria-label="Orders data list">
        <thead>
          <tr>
            <th scope="col" data-column="rowNumber">#</th>
            {columns.map((column) => <th key={column.key} scope="col" data-column={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} data-urgent={row.urgent}>
              <td data-column="rowNumber">{startIndex + index + 1}</td>
              {columns.map((column) => (
                <td key={column.key} data-column={column.key}>
                  <CellValue
                    row={row}
                    column={column.key}
                    label={column.label}
                    onOpen={onOpen}
                    editAccess={{
                      canUpdate,
                      canUpdateFinance,
                      canUpdateProductionStatus,
                      canUpdateDeliveryStatus,
                      assignees,
                      onSaved,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
