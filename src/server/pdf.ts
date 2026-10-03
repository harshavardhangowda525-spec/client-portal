import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { company } from "@/lib/config";
import { formatMoneyPlain } from "@/lib/money";
import { fmtDate, fmtDateTime, PAYMENT_METHODS, QUOTE_STATUS, INVOICE_STATUS } from "@/lib/format";
import type { QuoteItem, QuoteVersion } from "./quotations";

const NAVY = rgb(0.035, 0.07, 0.16);
const BLUE = rgb(0.18, 0.47, 1);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.87, 0.89, 0.92);
const PAGE = { w: 595.28, h: 841.89, m: 48 };

/** Standard PDF fonts use WinAnsi; replace characters it cannot encode. */
function clean(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/₹/g, "INR ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[•·]/g, "-").replace(/\t/g, "  ").replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "?");
}

class Writer {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  pageNo = 0;

  static async create(title: string) {
    const w = new Writer();
    w.doc = await PDFDocument.create();
    w.doc.setTitle(clean(title));
    w.doc.setAuthor(clean(company().name));
    w.doc.setCreator(clean(company().name));
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pageNo++;
    this.y = PAGE.h - PAGE.m;
    this.page.drawText(clean(`${company().name}  ·  Page ${this.pageNo}`).replace("?", "-"), { x: PAGE.m, y: 24, size: 8, font: this.font, color: MUTED });
  }

  ensure(h: number) {
    if (this.y - h < PAGE.m) this.newPage();
  }

  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) line = tryLine;
        else {
          if (line) out.push(line);
          line = word;
          while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
      }
      out.push(line);
    }
    return out;
  }

  text(t: string, opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? PAGE.m;
    const lines = this.wrap(t, size, opts.width ?? PAGE.w - x - PAGE.m, font);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + (opts.gap ?? 4);
    }
  }

  right(t: string, xRight: number, y: number, size = 10, bold = false, color = INK) {
    const font = bold ? this.bold : this.font;
    const s = clean(t);
    this.page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  }

  heading(t: string) {
    this.ensure(40);
    this.y -= 14;
    this.page.drawText(clean(t).toUpperCase(), { x: PAGE.m, y: this.y - 9, size: 9, font: this.bold, color: BLUE });
    this.y -= 18;
  }

  rule() {
    this.page.drawLine({ start: { x: PAGE.m, y: this.y }, end: { x: PAGE.w - PAGE.m, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 8;
  }

  header(docType: string, number: string, statusLabel?: string) {
    const co = company();
    this.page.drawRectangle({ x: 0, y: PAGE.h - 110, width: PAGE.w, height: 110, color: NAVY });
    this.page.drawRectangle({ x: 0, y: PAGE.h - 112, width: PAGE.w, height: 2, color: BLUE });
    this.page.drawText(clean(co.name), { x: PAGE.m, y: PAGE.h - 52, size: 18, font: this.bold, color: rgb(1, 1, 1) });
    const sub = [co.email, co.phone].filter(Boolean).join("  |  ") || "Websites, apps & digital solutions";
    this.page.drawText(clean(sub), { x: PAGE.m, y: PAGE.h - 70, size: 9, font: this.font, color: rgb(0.75, 0.8, 0.9) });
    if (co.address) this.page.drawText(clean(co.address).slice(0, 90), { x: PAGE.m, y: PAGE.h - 84, size: 8, font: this.font, color: rgb(0.65, 0.7, 0.8) });
    this.right(docType.toUpperCase(), PAGE.w - PAGE.m, PAGE.h - 50, 16, true, rgb(1, 1, 1));
    this.right(number, PAGE.w - PAGE.m, PAGE.h - 68, 10, false, rgb(0.75, 0.8, 0.9));
    if (statusLabel) this.right(statusLabel, PAGE.w - PAGE.m, PAGE.h - 84, 9, true, rgb(0.55, 0.75, 1));
    this.y = PAGE.h - 136;
  }

  twoCol(left: [string, string][], right: [string, string][]) {
    const startY = this.y;
    const colW = (PAGE.w - PAGE.m * 2) / 2;
    let ly = startY;
    for (const [k, v] of left) {
      this.page.drawText(clean(k), { x: PAGE.m, y: ly - 8, size: 8, font: this.font, color: MUTED });
      const lines = this.wrap(v || "-", 10, colW - 16, this.bold);
      lines.forEach((l, i) => this.page.drawText(l, { x: PAGE.m, y: ly - 21 - i * 13, size: 10, font: this.bold, color: INK }));
      ly -= 24 + lines.length * 13 - 4;
    }
    let ry = startY;
    for (const [k, v] of right) {
      this.page.drawText(clean(k), { x: PAGE.m + colW, y: ry - 8, size: 8, font: this.font, color: MUTED });
      this.page.drawText(clean(v || "-"), { x: PAGE.m + colW, y: ry - 21, size: 10, font: this.bold, color: INK });
      ry -= 33;
    }
    this.y = Math.min(ly, ry) - 6;
  }

  table(cols: { label: string; width: number; align?: "right" }[], rows: string[][], subRows?: (string | null)[]) {
    const x0 = PAGE.m;
    const drawHead = () => {
      this.ensure(30);
      this.page.drawRectangle({ x: x0, y: this.y - 20, width: PAGE.w - PAGE.m * 2, height: 20, color: rgb(0.95, 0.96, 0.98) });
      let x = x0 + 8;
      for (const c of cols) {
        if (c.align === "right") this.right(c.label, x + c.width - 16, this.y - 13, 8, true, MUTED);
        else this.page.drawText(clean(c.label), { x, y: this.y - 13, size: 8, font: this.bold, color: MUTED });
        x += c.width;
      }
      this.y -= 26;
    };
    drawHead();
    rows.forEach((r, ri) => {
      const firstLines = this.wrap(r[0], 10, cols[0].width - 16, this.bold);
      const sub = subRows?.[ri] ? this.wrap(subRows[ri]!, 8.5, cols[0].width - 16) : [];
      const h = firstLines.length * 13 + sub.length * 11 + 10;
      if (this.y - h < PAGE.m) { this.newPage(); drawHead(); }
      let x = x0 + 8;
      cols.forEach((c, ci) => {
        if (ci === 0) {
          firstLines.forEach((l, i) => this.page.drawText(l, { x, y: this.y - 10 - i * 13, size: 10, font: this.bold, color: INK }));
          sub.forEach((l, i) => this.page.drawText(l, { x, y: this.y - 10 - firstLines.length * 13 - i * 11, size: 8.5, font: this.font, color: MUTED }));
        } else if (c.align === "right") this.right(r[ci], x + c.width - 16, this.y - 10);
        else this.page.drawText(clean(r[ci]), { x, y: this.y - 10, size: 10, font: this.font, color: INK });
        x += c.width;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: x0, y: this.y + 4 }, end: { x: PAGE.w - PAGE.m, y: this.y + 4 }, thickness: 0.5, color: LINE });
    });
  }

  totals(rows: [string, string, boolean?][]) {
    const xr = PAGE.w - PAGE.m;
    for (const [k, v, strong] of rows) {
      this.ensure(22);
      if (strong) {
        this.page.drawRectangle({ x: xr - 230, y: this.y - 22, width: 230, height: 24, color: NAVY });
        this.page.drawText(clean(k), { x: xr - 220, y: this.y - 15, size: 11, font: this.bold, color: rgb(1, 1, 1) });
        this.right(v, xr - 10, this.y - 15, 11, true, rgb(1, 1, 1));
        this.y -= 30;
      } else {
        this.page.drawText(clean(k), { x: xr - 220, y: this.y - 10, size: 10, font: this.font, color: MUTED });
        this.right(v, xr - 10, this.y - 10, 10);
        this.y -= 17;
      }
    }
  }

  bullets(items: string[]) {
    for (const it of items) this.text(`-  ${it}`, { x: PAGE.m + 4, size: 9.5 });
  }

  save() {
    return this.doc.save();
  }
}

export async function quotationPdf(
  v: QuoteVersion & { number: string; title: string },
  items: QuoteItem[],
  acceptance: { signer_name: string; accepted_at: Date; content_hash: string; user_email: string } | null,
) {
  const w = await Writer.create(`Quotation ${v.number}`);
  const m = (n: number) => formatMoneyPlain(Number(n), v.currency);
  w.header("Quotation", `${v.number}  ·  Version ${v.version_no}`, QUOTE_STATUS[v.status] ?? v.status);
  const c = v.client_snapshot;
  w.twoCol(
    [["Prepared for", `${c.owner_name ?? ""}${c.business_name ? `, ${c.business_name}` : ""}`], ["Contact", [c.email, c.phone].filter(Boolean).join("  |  ")], ["Project", v.title]],
    [["Quotation date", fmtDate(v.issue_date)], ["Valid until", fmtDate(v.valid_until)], ["Estimated delivery", v.delivery_timeline?.slice(0, 60) ?? "-"]],
  );
  if (v.project_description) { w.heading("Project description"); w.text(v.project_description, { size: 9.5 }); }
  w.heading("Services & pricing");
  w.table(
    [{ label: "Service", width: 275 }, { label: "Qty", width: 50, align: "right" }, { label: "Unit price", width: 87, align: "right" }, { label: "Amount", width: 87, align: "right" }],
    items.map((i) => [i.description, String(Number(i.quantity)), m(i.unit_price), m(i.amount)]),
    items.map((i) => i.details),
  );
  w.y -= 8;
  const t: [string, string, boolean?][] = [["Subtotal", m(v.subtotal)]];
  if (Number(v.discount_amount) > 0) t.push([`Discount${v.discount_type === "percent" ? ` (${Number(v.discount_value)}%)` : ""}`, `- ${m(v.discount_amount)}`]);
  if (Number(v.tax_rate) > 0) t.push([`${v.tax_label} (${Number(v.tax_rate)}%)`, m(v.tax_amount)]);
  t.push(["Total", m(v.total), true]);
  w.totals(t);
  if (v.payment_terms.length) {
    w.heading("Payment milestones");
    w.table([{ label: "Milestone", width: 220 }, { label: "Due", width: 160 }, { label: "Share", width: 45, align: "right" }, { label: "Amount", width: 74, align: "right" }],
      v.payment_terms.map((p) => [p.label, p.due, `${p.percent}%`, m(p.amount ?? 0)]));
    w.text("Payments are recorded only after they have been received and confirmed.", { size: 8.5, color: MUTED });
  }
  if (v.included_features.length) { w.heading("Included"); w.bullets(v.included_features); }
  if (v.exclusions.length) { w.heading("Not included"); w.bullets(v.exclusions); }
  w.heading("Revisions"); w.text(`${v.revisions_included} round${v.revisions_included === 1 ? "" : "s"} of revisions are included. Further revisions are quoted separately.`, { size: 9.5 });
  if (v.maintenance_terms) { w.heading("Maintenance & support"); w.text(v.maintenance_terms, { size: 9.5 }); }
  if (v.domain_hosting_terms) { w.heading("Domain & hosting"); w.text(v.domain_hosting_terms, { size: 9.5 }); }
  if (v.delivery_timeline) { w.heading("Estimated timeline"); w.text(v.delivery_timeline, { size: 9.5 }); }
  if (v.terms_conditions) { w.heading("Terms & conditions"); w.text(v.terms_conditions, { size: 9 }); }
  w.heading("Acceptance");
  if (acceptance) {
    w.text(`Accepted electronically by ${acceptance.signer_name} (${acceptance.user_email}) on ${fmtDateTime(acceptance.accepted_at)}.`, { size: 9.5, bold: true });
    w.text(`Version ${v.version_no}. Content fingerprint (SHA-256): ${acceptance.content_hash}`, { size: 8, color: MUTED });
  } else {
    w.text("This quotation can be reviewed and accepted securely in your client portal.", { size: 9.5, color: MUTED });
  }
  return w.save();
}

export async function invoicePdf(data: {
  invoice: { number: string; title: string; description: string | null; amount: number; currency: string; status: string; issue_date: string | null; due_date: string | null };
  client: { business_name: string; owner_name: string; email: string; phone: string | null; address: string | null };
  project: { name: string };
  payments: { amount: number; paid_on: string | null; method: string; reference: string | null; receipt_number: string | null }[];
  paid: number; balance: number;
}) {
  const { invoice: i, client: c } = data;
  const m = (n: number) => formatMoneyPlain(Number(n), i.currency);
  const w = await Writer.create(`Invoice ${i.number}`);
  w.header("Invoice", i.number, INVOICE_STATUS[i.status] ?? i.status);
  const co = company();
  w.twoCol(
    [["Billed to", `${c.owner_name}, ${c.business_name}`], ["Contact", [c.email, c.phone].filter(Boolean).join("  |  ")], ["Project", data.project.name]],
    [["Invoice date", fmtDate(i.issue_date)], ["Due date", fmtDate(i.due_date)], ...(co.taxId ? [["Tax ID", co.taxId] as [string, string]] : [])],
  );
  w.heading("Details");
  w.table([{ label: "Description", width: 400 }, { label: "Amount", width: 99, align: "right" }], [[i.title, m(i.amount)]], [i.description]);
  w.y -= 8;
  w.totals([["Invoice total", m(i.amount)], ["Paid (confirmed)", m(data.paid)], ["Balance due", m(data.balance), true]]);
  if (data.payments.length) {
    w.heading("Payments received");
    w.table([{ label: "Receipt", width: 130 }, { label: "Date", width: 90 }, { label: "Method", width: 100 }, { label: "Reference", width: 100 }, { label: "Amount", width: 79, align: "right" }],
      data.payments.map((p) => [p.receipt_number ?? "-", fmtDate(p.paid_on), PAYMENT_METHODS[p.method] ?? p.method, p.reference ?? "-", m(p.amount)]));
  }
  w.text("Please include the invoice number as the payment reference.", { size: 8.5, color: MUTED });
  return w.save();
}

export async function receiptPdf(data: {
  payment: { receipt_number: string | null; amount: number; currency: string; paid_on: string | null; method: string; reference: string | null; invoice_number: string | null; status: string; confirmed_at: Date | null };
  client: { business_name: string; owner_name: string; email: string };
  project: { name: string };
}) {
  const p = data.payment;
  const w = await Writer.create(`Receipt ${p.receipt_number}`);
  w.header("Payment receipt", p.receipt_number ?? "-", "Confirmed");
  w.twoCol(
    [["Received from", `${data.client.owner_name}, ${data.client.business_name}`], ["Project", data.project.name], ["Against invoice", p.invoice_number ?? "-"]],
    [["Payment date", fmtDate(p.paid_on)], ["Method", PAYMENT_METHODS[p.method] ?? p.method], ["Reference", p.reference ?? "-"]],
  );
  w.y -= 10;
  w.totals([["Amount received", formatMoneyPlain(Number(p.amount), p.currency), true]]);
  w.text(`Confirmed on ${fmtDateTime(p.confirmed_at)}. Thank you for your payment.`, { size: 9.5, color: MUTED });
  return w.save();
}
