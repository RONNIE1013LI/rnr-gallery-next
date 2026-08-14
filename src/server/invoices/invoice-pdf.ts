import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InvoiceRecord } from "./invoice-service";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const INK = rgb(0.09, 0.11, 0.14);
const MUTED = rgb(0.39, 0.42, 0.46);
const RULE = rgb(0.82, 0.83, 0.84);
const ACCENT = rgb(0.12, 0.24, 0.29);

function safeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\xFF\n\r\t]/g, "?")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function money(cents: number) {
  return `NZ$${(cents / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function quantity(milli: number) {
  const value = milli / 1_000;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");
}

function wrappedLines(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const sourceLine of safeText(text).split(/\r?\n/)) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      let remainder = word;
      while (font.widthOfTextAtSize(remainder, size) > maxWidth && remainder.length > 1) {
        let end = remainder.length - 1;
        while (end > 1 && font.widthOfTextAtSize(remainder.slice(0, end), size) > maxWidth) end -= 1;
        lines.push(remainder.slice(0, end));
        remainder = remainder.slice(end);
      }
      line = remainder;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawLines(page: PDFPage, lines: readonly string[], input: Readonly<{
  x: number;
  y: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
}>) {
  const lineHeight = input.lineHeight ?? input.size * 1.3;
  lines.forEach((line, index) => page.drawText(line, {
    x: input.x,
    y: input.y - index * lineHeight,
    size: input.size,
    font: input.font,
    color: input.color ?? INK,
  }));
  return input.y - lines.length * lineHeight;
}

export async function createInvoicePdf(invoice: InvoiceRecord) {
  const document = await PDFDocument.create();
  document.setTitle(`Tax Invoice ${safeText(invoice.invoiceNumber)}`);
  document.setAuthor(safeText(invoice.businessName));
  document.setSubject("R&R Gallery tax invoice");
  document.setCreator("R&R Gallery administration");
  document.setProducer("R&R Gallery administration");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const right = PAGE_WIDTH - MARGIN;

  page.drawText(safeText(invoice.businessName), { x: MARGIN, y, size: 20, font: bold, color: ACCENT });
  page.drawText("TAX INVOICE", {
    x: right - bold.widthOfTextAtSize("TAX INVOICE", 20), y, size: 20, font: bold, color: INK,
  });
  y -= 27;
  const companyLines = wrappedLines(invoice.businessAddress, regular, 8.5, 235);
  drawLines(page, companyLines, { x: MARGIN, y, font: regular, size: 8.5, color: MUTED, lineHeight: 11 });
  const meta = [
    ["Invoice", invoice.invoiceNumber],
    ["Date", invoice.invoiceDate],
    ["Due", invoice.dueDate],
    ["Reference", invoice.reference || "-"],
  ] as const;
  meta.forEach(([label, value], index) => {
    const rowY = y - index * 13;
    page.drawText(label, { x: 350, y: rowY, size: 8.5, font: regular, color: MUTED });
    const text = safeText(value);
    page.drawText(text, { x: right - bold.widthOfTextAtSize(text, 8.5), y: rowY, size: 8.5, font: bold, color: INK });
  });
  y -= Math.max(companyLines.length * 11, meta.length * 13) + 22;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.8, color: RULE });
  y -= 22;

  page.drawText("BILL TO", { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  page.drawText("DELIVER TO", { x: 305, y, size: 8, font: bold, color: MUTED });
  y -= 16;
  const customerLines = wrappedLines([
    invoice.customerName,
    invoice.customerEmail,
    invoice.customerAddress,
  ].filter(Boolean).join("\n"), regular, 9.5, 220);
  const deliveryLines = wrappedLines(invoice.deliveryAddress || invoice.customerAddress, regular, 9.5, 220);
  drawLines(page, customerLines, { x: MARGIN, y, font: regular, size: 9.5, lineHeight: 13 });
  drawLines(page, deliveryLines, { x: 305, y, font: regular, size: 9.5, lineHeight: 13 });
  y -= Math.max(customerLines.length, deliveryLines.length, 1) * 13 + 25;

  function tableHeader(targetPage: PDFPage, rowY: number) {
    targetPage.drawRectangle({ x: MARGIN, y: rowY - 5, width: right - MARGIN, height: 23, color: ACCENT });
    const headings = [["CODE", MARGIN + 8], ["DESCRIPTION", 126], ["QTY", 377], ["RATE", 430], ["AMOUNT", 507]] as const;
    headings.forEach(([heading, x]) => targetPage.drawText(heading, { x, y: rowY + 3, size: 7.5, font: bold, color: rgb(1, 1, 1) }));
    return rowY - 20;
  }

  y = tableHeader(page, y);
  for (const item of invoice.items) {
    const description = wrappedLines(item.description, regular, 8.5, 235);
    const rowHeight = Math.max(25, description.length * 11 + 10);
    if (y - rowHeight < 190) {
      page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = tableHeader(page, PAGE_HEIGHT - MARGIN);
    }
    const baseline = y - 13;
    page.drawText(safeText(item.code || "PRD"), { x: MARGIN + 8, y: baseline, size: 8.5, font: regular, color: INK });
    drawLines(page, description, { x: 126, y: baseline, font: regular, size: 8.5, lineHeight: 11 });
    const qty = quantity(item.quantityMilli);
    page.drawText(qty, { x: 405 - regular.widthOfTextAtSize(qty, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    const rate = money(item.rateInclGstCents);
    page.drawText(rate, { x: 491 - regular.widthOfTextAtSize(rate, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    const amount = money(item.lineTotalInclGstCents);
    page.drawText(amount, { x: right - regular.widthOfTextAtSize(amount, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    y -= rowHeight;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.5, color: RULE });
  }

  y -= 18;
  const totals = [
    ["Gross incl GST", invoice.grossCents],
    ...(invoice.discountCents ? [["Discount", -invoice.discountCents] as const] : []),
    ["Subtotal ex GST", invoice.subtotalExGstCents],
    ["GST (15%)", invoice.gstCents],
  ] as const;
  totals.forEach(([label, cents], index) => {
    const rowY = y - index * 15;
    page.drawText(label, { x: 375, y: rowY, size: 8.5, font: regular, color: MUTED });
    const text = money(cents);
    page.drawText(text, { x: right - regular.widthOfTextAtSize(text, 8.5), y: rowY, size: 8.5, font: regular, color: INK });
  });
  y -= totals.length * 15 + 4;
  page.drawLine({ start: { x: 375, y: y + 9 }, end: { x: right, y: y + 9 }, thickness: 1, color: INK });
  page.drawText("TOTAL INCL GST", { x: 375, y: y - 2, size: 10, font: bold, color: INK });
  const total = money(invoice.totalInclGstCents);
  page.drawText(total, { x: right - bold.widthOfTextAtSize(total, 10), y: y - 2, size: 10, font: bold, color: INK });

  const lowerY = Math.min(y - 32, 150);
  page.drawText("PAYMENT", { x: MARGIN, y: lowerY, size: 8, font: bold, color: MUTED });
  drawLines(page, wrappedLines(`Bank account: ${invoice.bankAccount}\n${invoice.notes}`, regular, 8.5, 300), {
    x: MARGIN, y: lowerY - 15, font: regular, size: 8.5, lineHeight: 11,
  });
  page.drawText("TERMS", { x: MARGIN, y: 82, size: 8, font: bold, color: MUTED });
  drawLines(page, wrappedLines(invoice.terms, regular, 7.5, right - MARGIN), {
    x: MARGIN, y: 69, font: regular, size: 7.5, color: MUTED, lineHeight: 9,
  });
  page.drawLine({ start: { x: MARGIN, y: 43 }, end: { x: right, y: 43 }, thickness: 0.5, color: RULE });
  const footer = [invoice.businessPhone, invoice.businessEmail, invoice.businessWebsite, `GST: ${invoice.gstNumber}`]
    .filter(Boolean).join("  |  ");
  page.drawText(safeText(footer), { x: MARGIN, y: 29, size: 6.8, font: regular, color: MUTED });

  return document.save({ useObjectStreams: false });
}
