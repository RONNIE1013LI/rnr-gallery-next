import { describe, expect, it } from "vitest";

import {
  FORM_ACTIVE_FIELDS,
  FORM_LIST_COLUMNS,
  FORM_OPTION_SETS,
  FORM_ROLE_PRESETS,
  FORM_STAT_WIDGET_TYPES,
} from "./forms-parity";

describe("forms source parity", () => {
  it("preserves the source list order", () => {
    expect(FORM_LIST_COLUMNS.map((column) => column.label)).toEqual([
      "Submitted Time",
      "Ref No.",
      "Web Order No.",
      "Size",
      "Urgent?",
      "DlvryDate",
      "DlvryMethod",
      "Customer Source",
      "Cust.Name",
      "Assign Artist",
      "Artist",
      "File Sent",
      "Download",
      "Customer Notified",
      "Printed",
      "Completed",
      "Delivered",
      "BankRecon",
      "AmtOwe",
      "AmtPaid",
      "AmtPayable",
      "Artist's Fee",
      "Remark",
      "Submitted By",
    ]);
  });

  it("marks derived and protected columns as non-editable", () => {
    expect(FORM_LIST_COLUMNS.find((column) => column.key === "amountOwing")).toMatchObject({
      editable: false,
      finance: true,
    });
    expect(FORM_LIST_COLUMNS.find((column) => column.key === "reference")?.editable).toBe(false);
    expect(FORM_LIST_COLUMNS.find((column) => column.key === "artistFee")).toMatchObject({
      editable: true,
      finance: true,
    });
  });

  it("preserves operational option sets", () => {
    expect(FORM_OPTION_SETS.deliveryMethod).toEqual([
      "Pick up",
      "Delivery",
      "Post",
      "Email",
      "Courier",
      "Australia Shipping",
      "Other",
    ]);
    expect(FORM_OPTION_SETS.customerSource).toEqual([
      "R&R",
      "Web",
      "Market",
      "Email",
      "IG",
      "TikTok",
      "Whatsapp",
      "WeChat",
    ]);
    expect(FORM_OPTION_SETS.bankRecon).toEqual([
      "Not checked",
      "Arrive",
      "Afterpay",
      "Stripe",
      "Wise",
      "waitting..",
      "Checked1",
      "Checked2",
      "Checked3",
      "Checked4",
      "Checked5",
      "Checked6",
      "Other",
    ]);
  });

  it("preserves every active source field and hides history-only values from normal entry", () => {
    expect(FORM_ACTIVE_FIELDS.map((field) => field.key)).toEqual([
      "webOrderNumber",
      "size",
      "sizeOther",
      "designUpload",
      "paymentProof",
      "amountPayable",
      "amountPaid",
      "amountOwing",
      "bankRecon",
      "designRequirement",
      "remark",
      "urgent",
      "deliveryMethod",
      "neededDate",
      "deliveryAddress",
      "customerSource",
      "customerName",
      "phone",
      "email",
      "assignArtist",
      "artist",
      "fileSent",
      "downloaded",
      "printed",
      "completed",
      "customerNotified",
      "delivered",
      "status",
      "artistFee",
      "materialCost",
      "actualProfit",
    ]);
    expect(FORM_ACTIVE_FIELDS.filter((field) => field.detailOnly).map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "phone",
        "email",
        "paymentProof",
        "deliveryAddress",
        "designRequirement",
        "designUpload",
        "materialCost",
        "actualProfit",
        "status",
      ]),
    );
  });

  it("preserves source role intent and custom statistics widget types", () => {
    expect(Object.keys(FORM_ROLE_PRESETS)).toEqual([
      "owner",
      "manager",
      "artist",
      "finance",
      "readOnly",
    ]);
    expect(FORM_ROLE_PRESETS.artist.assignedOnly).toBe(true);
    expect(FORM_ROLE_PRESETS.finance.permissions).toContain("update_finance");
    expect(FORM_STAT_WIDGET_TYPES).toEqual([
      "bar",
      "pie",
      "line",
      "table",
      "number",
      "divider",
      "text",
    ]);
  });
});
