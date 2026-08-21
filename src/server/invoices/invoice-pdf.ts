import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMarketMoney } from "@/domain/money";
import { invoiceCustomerAddressLines, invoiceDeliveryAddressLines } from "./invoice-address-lines";
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

function drawRightLines(page: PDFPage, lines: readonly string[], input: Readonly<{
  right: number;
  y: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
}>) {
  const lineHeight = input.lineHeight ?? input.size * 1.3;
  lines.forEach((line, index) => page.drawText(line, {
    x: input.right - input.font.widthOfTextAtSize(line, input.size),
    y: input.y - index * lineHeight,
    size: input.size,
    font: input.font,
    color: input.color ?? INK,
  }));
}

async function embedBrandLogo(document: PDFDocument) {
  try {
    const bytes = await readFile(join(process.cwd(), "public/media/brand/rr-gallery-email-logo.png"));
    return await document.embedPng(bytes.toString("base64"));
  } catch {
    return null;
  }
}

export async function createInvoicePdf(invoice: InvoiceRecord) {
  const money = (cents: number) => formatMarketMoney(cents, invoice.currency);
  const hasTax = invoice.gstRateBasisPoints > 0;
  const document = await PDFDocument.create();
  document.setTitle(`Tax Invoice ${safeText(invoice.invoiceNumber)}`);
  document.setAuthor(safeText(invoice.businessName));
  document.setSubject("R&R Gallery tax invoice");
  document.setCreator("R&R Gallery administration");
  document.setProducer("R&R Gallery administration");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedBrandLogo(document);

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const right = PAGE_WIDTH - MARGIN;
  const headerTop = PAGE_HEIGHT - MARGIN;
  if (logo) page.drawImage(logo, { x: MARGIN, y: headerTop - 74, width: 74, height: 74 });
  else page.drawText(safeText(invoice.businessName), { x: MARGIN, y: headerTop - 20, size: 20, font: bold, color: ACCENT });
  const companyLines = [safeText(invoice.businessName), ...wrappedLines(invoice.businessAddress, regular, 8.5, 225)];
  drawRightLines(page, companyLines, { right, y: headerTop - 6, font: regular, size: 8.5, color: MUTED, lineHeight: 11 });
  if (invoice.gstNumber) drawRightLines(page, [`GST No: ${safeText(invoice.gstNumber)}`], {
    right, y: headerTop - companyLines.length * 11 - 6, font: regular, size: 8.5, color: MUTED,
  });

  let y = headerTop - 104;
  page.drawText("Customer Address", { x: MARGIN, y, size: 8, font: bold, color: INK });
  drawRightLines(page, ["Deliver To"], { right, y, size: 8, font: bold, color: INK });
  y -= 16;
  const customerLines = wrappedLines(invoiceCustomerAddressLines(invoice).join("\n"), regular, 9.5, 220);
  const deliveryLines = wrappedLines(invoiceDeliveryAddressLines(invoice).join("\n"), regular, 9.5, 220);
  drawLines(page, customerLines, { x: MARGIN, y, font: regular, size: 9.5, lineHeight: 13 });
  drawRightLines(page, deliveryLines, { right, y, font: regular, size: 9.5, lineHeight: 13 });
  y -= Math.max(customerLines.length, deliveryLines.length, 1) * 13 + 22;

  const metaHeight = 66;
  page.drawRectangle({ x: MARGIN, y: y - metaHeight, width: right - MARGIN, height: metaHeight, borderWidth: 0.8, borderColor: INK });
  page.drawText(`Tax Invoice # ${safeText(invoice.invoiceNumber)}`, { x: MARGIN + 10, y: y - 17, size: 11, font: bold, color: INK });
  page.drawLine({ start: { x: MARGIN, y: y - 25 }, end: { x: right, y: y - 25 }, thickness: 0.8, color: INK });
  const metaRows = [
    ["Invoice Date:", invoice.invoiceDate, "Customer:", invoice.customerName || "-"],
    ["Reference:", invoice.reference || "DRAFT", "Due Date:", invoice.dueDate],
  ] as const;
  metaRows.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
    const rowY = y - 39 - index * 14;
    page.drawText(leftLabel, { x: MARGIN + 10, y: rowY, size: 7.5, font: regular, color: MUTED });
    page.drawText(safeText(leftValue), { x: MARGIN + 78, y: rowY, size: 8, font: regular, color: INK });
    page.drawText(rightLabel, { x: 305, y: rowY, size: 7.5, font: regular, color: MUTED });
    page.drawText(safeText(rightValue).slice(0, 44), { x: 365, y: rowY, size: 8, font: regular, color: INK });
  });
  y -= metaHeight + 22;

  function tableHeader(targetPage: PDFPage, rowY: number) {
    targetPage.drawRectangle({ x: MARGIN, y: rowY - 20, width: right - MARGIN, height: 20, borderWidth: 0.8, borderColor: INK });
    [145, 370, 416, 498].forEach((x) => targetPage.drawLine({ start: { x, y: rowY }, end: { x, y: rowY - 20 }, thickness: 0.6, color: INK }));
    const headings = [["CODE", MARGIN + 7], ["DESCRIPTION", 153], ["QTY", 380], ["PRICE", 430], ["AMOUNT", 507]] as const;
    headings.forEach(([heading, x]) => targetPage.drawText(heading, { x, y: rowY - 13, size: 7.5, font: bold, color: INK }));
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
    const baseline = y - 15;
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: right - MARGIN, height: rowHeight, borderWidth: 0.6, borderColor: INK });
    [145, 370, 416, 498].forEach((x) => page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.5, color: INK }));
    page.drawText(safeText(item.code || "PRD"), { x: MARGIN + 8, y: baseline, size: 8.5, font: regular, color: INK });
    drawLines(page, description, { x: 153, y: baseline, font: regular, size: 8.5, lineHeight: 11 });
    const qty = quantity(item.quantityMilli);
    page.drawText(qty, { x: 405 - regular.widthOfTextAtSize(qty, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    const rate = money(item.rateInclGstCents);
    page.drawText(rate, { x: 491 - regular.widthOfTextAtSize(rate, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    const amount = money(item.lineTotalInclGstCents);
    page.drawText(amount, { x: right - regular.widthOfTextAtSize(amount, 8.5), y: baseline, size: 8.5, font: regular, color: INK });
    y -= rowHeight;
  }

  if (y < 180) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }
  y -= 24;
  page.drawText(`Payment to: ${safeText(invoice.bankAccount)}`, { x: MARGIN, y, size: 9, font: bold, color: INK });
  const noteLines = wrappedLines(invoice.notes, regular, 8.5, 270);
  drawLines(page, noteLines, { x: MARGIN, y: y - 16, font: regular, size: 8.5, lineHeight: 11 });
  const termsY = y - Math.max(noteLines.length, 1) * 11 - 26;
  drawLines(page, wrappedLines(invoice.terms, regular, 7.5, 270), {
    x: MARGIN, y: termsY, font: regular, size: 7.5, color: MUTED, lineHeight: 9,
  });

  const totals = [
    [hasTax ? "Subtotal ex GST" : "Subtotal", invoice.subtotalExGstCents],
    ...(hasTax ? [[`GST (${invoice.gstRateBasisPoints / 100}%)`, invoice.gstCents] as const] : []),
    ...(invoice.discountCents ? [["Discount", -invoice.discountCents] as const] : []),
  ] as const;
  totals.forEach(([label, cents], index) => {
    const rowY = y - index * 15;
    page.drawText(label, { x: 375, y: rowY, size: 8.5, font: regular, color: MUTED });
    const text = money(cents);
    page.drawText(text, { x: right - regular.widthOfTextAtSize(text, 8.5), y: rowY, size: 8.5, font: regular, color: INK });
  });
  const totalY = y - totals.length * 15 - 2;
  page.drawLine({ start: { x: 375, y: totalY + 9 }, end: { x: right, y: totalY + 9 }, thickness: 1, color: INK });
  page.drawText("Total", { x: 375, y: totalY - 2, size: 10, font: bold, color: INK });
  const total = money(invoice.totalInclGstCents);
  page.drawText(total, { x: right - bold.widthOfTextAtSize(total, 10), y: totalY - 2, size: 10, font: bold, color: INK });

  page.drawLine({ start: { x: MARGIN, y: 43 }, end: { x: right, y: 43 }, thickness: 0.5, color: RULE });
  const footer = [invoice.businessPhone, invoice.businessEmail, invoice.businessWebsite, `GST: ${invoice.gstNumber}`]
    .filter(Boolean).join("  |  ");
  page.drawText(safeText(footer), { x: MARGIN, y: 29, size: 6.8, font: regular, color: MUTED });

  return document.save({ useObjectStreams: false });
}
