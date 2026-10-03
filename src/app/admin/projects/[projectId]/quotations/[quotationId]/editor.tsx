"use client";

import { useMemo, useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { saveDraftAction } from "@/app/actions/admin";
import { computeTotals, formatMoney, splitPaymentTerms } from "@/lib/money";

type Item = { description: string; details: string | null; quantity: number; unit_price: number };
type Term = { label: string; percent: number; due: string };
type Initial = {
  project_description: string | null; valid_until: string; discount_type: "none" | "percent" | "amount"; discount_value: number;
  tax_label: string; tax_rate: number; items: Item[]; payment_terms: Term[]; included_features: string[]; exclusions: string[];
  revisions_included: number; maintenance_terms: string | null; domain_hosting_terms: string | null; delivery_timeline: string | null;
  terms_conditions: string | null; admin_note?: string | null; currency: string;
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function QuoteEditor({ versionId, initial }: { versionId: string; initial: Initial }) {
  const [s, setS] = useState(() => ({
    ...initial,
    items: initial.items.map((i) => ({ description: i.description, details: i.details ?? "", quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
    payment_terms: initial.payment_terms.map((t) => ({ label: t.label, percent: Number(t.percent), due: t.due })),
    features: initial.included_features.join("\n"), excl: initial.exclusions.join("\n"),
    discount_value: Number(initial.discount_value), tax_rate: Number(initial.tax_rate),
  }));
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));
  const totals = useMemo(() => computeTotals(s.items.map((i) => ({ quantity: i.quantity || 0, unitPrice: i.unit_price || 0 })), s.discount_type, s.discount_value || 0, s.tax_rate || 0), [s]);
  const termAmounts = splitPaymentTerms(totals.total, s.payment_terms);
  const pct = s.payment_terms.reduce((a, t) => a + (Number(t.percent) || 0), 0);
  const m = (n: number) => formatMoney(n, initial.currency);
  const payload = JSON.stringify({
    project_description: s.project_description, valid_until: s.valid_until, discount_type: s.discount_type, discount_value: s.discount_value || 0,
    tax_label: s.tax_label, tax_rate: s.tax_rate || 0, items: s.items.map((i) => ({ ...i, details: i.details || null })), payment_terms: s.payment_terms,
    included_features: lines(s.features), exclusions: lines(s.excl), revisions_included: s.revisions_included,
    maintenance_terms: s.maintenance_terms, domain_hosting_terms: s.domain_hosting_terms, delivery_timeline: s.delivery_timeline,
    terms_conditions: s.terms_conditions, admin_note: s.admin_note ?? null,
  });
  const updItem = (i: number, k: keyof Item, v: string) => set("items", s.items.map((it, j) => (j === i ? { ...it, [k]: k === "quantity" || k === "unit_price" ? Number(v) : v } : it)));
  const updTerm = (i: number, k: keyof Term, v: string) => set("payment_terms", s.payment_terms.map((t, j) => (j === i ? { ...t, [k]: k === "percent" ? Number(v) : v } : t)));

  return (
    <ActionForm action={saveDraftAction.bind(null, versionId)} className="stack">
      <input type="hidden" name="payload" value={payload} />
      <section className="glass panel">
        <div className="panel-head"><h2>Draft quotation</h2><span className="badge">Draft — not visible to client</span></div>
        <div className="form-grid">
          <div className="field full"><label htmlFor="pd">Project description</label><textarea id="pd" className="textarea" value={s.project_description ?? ""} onChange={(e) => set("project_description", e.target.value)} maxLength={10000} /></div>
          <div className="field"><label htmlFor="vu">Valid until</label><input id="vu" type="date" className="input" value={s.valid_until} onChange={(e) => set("valid_until", e.target.value)} required /></div>
          <div className="field"><label htmlFor="dt">Delivery timeline</label><input id="dt" className="input" value={s.delivery_timeline ?? ""} onChange={(e) => set("delivery_timeline", e.target.value)} maxLength={2000} /></div>
        </div>
      </section>

      <section className="glass panel">
        <div className="panel-head"><h2>Line items</h2>
          <button type="button" className="btn btn-sm" onClick={() => set("items", [...s.items, { description: "", details: "", quantity: 1, unit_price: 0 }])}><Icon name="plus" /> Add item</button></div>
        <div className="stack">
          {s.items.map((it, i) => (
            <div key={i} className="glass" style={{ padding: 12, background: "rgba(0,0,0,.15)" }}>
              <div className="form-grid" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(70px,.7fr) minmax(110px,1.2fr) auto", alignItems: "end" }}>
                <div className="field"><label htmlFor={`d${i}`}>Service</label><input id={`d${i}`} className="input" value={it.description} onChange={(e) => updItem(i, "description", e.target.value)} required maxLength={500} /></div>
                <div className="field"><label htmlFor={`q${i}`}>Qty</label><input id={`q${i}`} type="number" min="0.01" step="0.01" className="input" value={it.quantity} onChange={(e) => updItem(i, "quantity", e.target.value)} required /></div>
                <div className="field"><label htmlFor={`p${i}`}>Unit price (₹)</label><input id={`p${i}`} type="number" min="0" step="0.01" className="input" value={it.unit_price} onChange={(e) => updItem(i, "unit_price", e.target.value)} required /></div>
                <button type="button" className="btn btn-ghost icon-btn" aria-label={`Remove item ${i + 1}`} onClick={() => set("items", s.items.filter((_, j) => j !== i))}><Icon name="trash" /></button>
                <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`x${i}`} className="sr-only">Details</label><input id={`x${i}`} className="input" placeholder="Details (optional)" value={it.details ?? ""} onChange={(e) => updItem(i, "details", e.target.value)} maxLength={2000} /></div>
              </div>
              <div className="right small muted" style={{ marginTop: 6 }}>{m(totals.lineAmounts[i] ?? 0)}</div>
            </div>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field"><label htmlFor="dty">Discount</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select id="dty" className="select" style={{ width: 130 }} value={s.discount_type} onChange={(e) => set("discount_type", e.target.value as never)}><option value="none">None</option><option value="percent">Percent</option><option value="amount">Amount</option></select>
              {s.discount_type !== "none" && <input aria-label="Discount value" type="number" min="0" step="0.01" className="input" value={s.discount_value} onChange={(e) => set("discount_value", Number(e.target.value))} />}
            </div></div>
          <div className="field"><label htmlFor="tl">Tax</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="tl" className="input" style={{ width: 110 }} value={s.tax_label} onChange={(e) => set("tax_label", e.target.value)} maxLength={40} aria-label="Tax label" />
              <input type="number" min="0" max="100" step="0.01" className="input" value={s.tax_rate} onChange={(e) => set("tax_rate", Number(e.target.value))} aria-label="Tax rate percent" /><span className="muted">%</span>
            </div></div>
        </div>
        <div className="totals">
          <div className="row-between"><span>Subtotal</span><span className="mono">{m(totals.subtotal)}</span></div>
          {totals.discountAmount > 0 && <div className="row-between"><span>Discount</span><span className="mono">− {m(totals.discountAmount)}</span></div>}
          {s.tax_rate > 0 && <div className="row-between"><span>{s.tax_label} ({s.tax_rate}%)</span><span className="mono">{m(totals.taxAmount)}</span></div>}
          <div className="row-between grand"><span>Total</span><span className="mono">{m(totals.total)}</span></div>
        </div>
      </section>

      <section className="glass panel">
        <div className="panel-head"><h2>Payment milestones</h2>
          <button type="button" className="btn btn-sm" onClick={() => set("payment_terms", [...s.payment_terms, { label: "", percent: 0, due: "" }])}><Icon name="plus" /> Add</button></div>
        <div className="stack">
          {s.payment_terms.map((t, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1.6fr) 90px 110px auto", alignItems: "end" }}>
              <div className="field"><label htmlFor={`tl${i}`}>Label</label><input id={`tl${i}`} className="input" value={t.label} onChange={(e) => updTerm(i, "label", e.target.value)} required maxLength={100} /></div>
              <div className="field"><label htmlFor={`td${i}`}>When due</label><input id={`td${i}`} className="input" value={t.due} onChange={(e) => updTerm(i, "due", e.target.value)} required maxLength={200} /></div>
              <div className="field"><label htmlFor={`tp${i}`}>%</label><input id={`tp${i}`} type="number" min="0" max="100" step="0.01" className="input" value={t.percent} onChange={(e) => updTerm(i, "percent", e.target.value)} required /></div>
              <div className="small mono muted" style={{ paddingBottom: 10 }}>{m(termAmounts[i]?.amount ?? 0)}</div>
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove payment milestone" onClick={() => set("payment_terms", s.payment_terms.filter((_, j) => j !== i))}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
        <p className={`small ${Math.abs(pct - 100) > 0.001 ? "" : "muted"}`} style={{ marginTop: 10, color: Math.abs(pct - 100) > 0.001 ? "var(--amber)" : undefined }}>Total: {pct}% {Math.abs(pct - 100) > 0.001 && "— must equal 100% before sending"}</p>
      </section>

      <section className="glass panel">
        <h2 style={{ marginBottom: 14 }}>Scope &amp; terms</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="inc">Included features (one per line)</label><textarea id="inc" className="textarea" style={{ minHeight: 140 }} value={s.features} onChange={(e) => set("features", e.target.value)} /></div>
          <div className="field"><label htmlFor="exc">Exclusions (one per line)</label><textarea id="exc" className="textarea" style={{ minHeight: 140 }} value={s.excl} onChange={(e) => set("excl", e.target.value)} /></div>
          <div className="field"><label htmlFor="rev">Revisions included</label><input id="rev" type="number" min="0" max="100" className="input" value={s.revisions_included} onChange={(e) => set("revisions_included", Number(e.target.value))} /></div>
          <div className="field full"><label htmlFor="mt">Maintenance &amp; support</label><textarea id="mt" className="textarea" value={s.maintenance_terms ?? ""} onChange={(e) => set("maintenance_terms", e.target.value)} /></div>
          <div className="field full"><label htmlFor="dh">Domain &amp; hosting</label><textarea id="dh" className="textarea" value={s.domain_hosting_terms ?? ""} onChange={(e) => set("domain_hosting_terms", e.target.value)} /></div>
          <div className="field full"><label htmlFor="tc">Terms &amp; conditions</label><textarea id="tc" className="textarea" style={{ minHeight: 140 }} value={s.terms_conditions ?? ""} onChange={(e) => set("terms_conditions", e.target.value)} /></div>
          <div className="field full"><label htmlFor="an">Internal note (never shown to client)</label><textarea id="an" className="textarea" style={{ minHeight: 60 }} value={s.admin_note ?? ""} onChange={(e) => set("admin_note", e.target.value)} /></div>
        </div>
      </section>
      <div className="form-actions" style={{ position: "sticky", bottom: 12 }}>
        <div className="glass row" style={{ padding: "8px 10px" }}><span className="small muted">Total {m(totals.total)}</span><Submit pendingText="Saving…">Save draft</Submit></div>
      </div>
    </ActionForm>
  );
}
